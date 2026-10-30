"""Offline deployment safety checks. These never call AWS, Docker or real key files."""

import argparse
import contextlib
import io
import json
import os
import stat
from pathlib import Path
import subprocess
import tempfile
import tarfile
import unittest
from unittest.mock import patch

import deploy
import instance
import keys


class DeploymentSafety(unittest.TestCase):
    def setUp(self):
        self.template = json.loads(deploy.TEMPLATE.read_text())
        self.environment = patch.dict(
            os.environ, {"TASTIP_AWS_EXPECTED_ACCOUNT": "111122223333"}
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def test_missing_or_malformed_expected_account_stops_before_aws(self):
        for value in ["", "default", "11112222333", "1111222233334", " 111122223333"]:
            with patch.dict(
                os.environ, {"TASTIP_AWS_EXPECTED_ACCOUNT": value}
            ), patch.object(deploy, "aws") as fake:
                with self.assertRaisesRegex(
                    RuntimeError, "TASTIP_AWS_EXPECTED_ACCOUNT"
                ):
                    deploy.identity()
                fake.assert_not_called()

    def test_wrong_account_and_missing_approval_cannot_reach_mutations(self):
        with patch.object(
            deploy, "aws", return_value={"Account": "444455556666"}
        ) as fake:
            with self.assertRaisesRegex(RuntimeError, "not the reviewed account"):
                deploy.approved(
                    argparse.Namespace(approved_account=deploy.expected_account())
                )
            self.assertEqual(
                fake.call_args_list[0].args, ("sts", "get-caller-identity")
            )
            self.assertEqual(fake.call_count, 1)
        with patch.object(deploy, "identity"):
            with self.assertRaisesRegex(RuntimeError, "writes AWS state"):
                deploy.approved(argparse.Namespace(approved_account=None))
        with patch.object(
            deploy, "aws", return_value={"Account": "111122223333"}
        ) as fake:
            deploy.approved(argparse.Namespace(approved_account="111122223333"))
            self.assertEqual(fake.call_count, 1)

    def test_every_local_aws_call_pins_profile_region_and_never_uses_default(self):
        with patch.object(deploy, "run", return_value='{"ok":true}') as fake:
            self.assertEqual(deploy.aws("ec2", "describe-vpcs"), {"ok": True})
            args = fake.call_args.args[0]
            self.assertEqual(
                args[:7],
                [
                    "aws",
                    "--profile",
                    "own",
                    "--region",
                    "ap-south-1",
                    "--no-cli-pager",
                    "ec2",
                ],
            )
            self.assertNotIn("default", args)

    def test_source_archive_rejects_tracked_secrets_and_generated_data(self):
        deploy.check_release_paths(
            [
                ".env.example",
                "apps/web/.env.example",
                "deploy/aws/instance.py",
                "apps/web/src/app/page.tsx",
            ]
        )
        for path in [
            ".env",
            "apps/web/.env.local",
            "apps/web/.data/trips.sqlite",
            "backups/private.tar",
            "key.pem",
            "server.key",
            "secrets.db",
            "tests/test-results/trace.zip",
        ]:
            with self.subTest(path=path), self.assertRaises(RuntimeError):
                deploy.check_release_paths([path])

    def test_live_cloudfront_policy_preflight_checks_resolved_names_and_semantics(self):
        cache = {
            "Name": "Managed-CachingDisabled",
            "MinTTL": 0,
            "DefaultTTL": 0,
            "MaxTTL": 0,
        }
        origin = {
            "Name": "Managed-AllViewer",
            "HeadersConfig": {"HeaderBehavior": "allViewer"},
            "CookiesConfig": {"CookieBehavior": "all"},
            "QueryStringsConfig": {"QueryStringBehavior": "all"},
        }

        def responses(cache_value, origin_value):
            return [
                {"CachePolicy": {"CachePolicyConfig": cache_value}},
                {"OriginRequestPolicy": {"OriginRequestPolicyConfig": origin_value}},
            ]

        with patch.object(deploy, "aws", side_effect=responses(cache, origin)) as fake:
            deploy.verify_cloudfront_policies()
            self.assertEqual(
                fake.call_args_list[0].args,
                (
                    "cloudfront",
                    "get-cache-policy",
                    "--id",
                    "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
                ),
            )
            self.assertEqual(
                fake.call_args_list[1].args,
                (
                    "cloudfront",
                    "get-origin-request-policy",
                    "--id",
                    "216adef6-5c7f-47e4-b989-5492eafa07d3",
                ),
            )
        for wrong in [
            {**cache, "Name": "Managed-CachingOptimized"},
            {**cache, "MinTTL": 1},
            {**cache, "DefaultTTL": 600},
            {**cache, "MaxTTL": 600},
        ]:
            with patch.object(
                deploy, "aws", side_effect=responses(wrong, origin)
            ) as fake:
                with self.assertRaisesRegex(RuntimeError, "all three TTLs zero"):
                    deploy.verify_cloudfront_policies()
                self.assertEqual(fake.call_count, 1)
        for wrong in [
            {**origin, "Name": "Managed-AllViewerExceptHostHeader"},
            {**origin, "HeadersConfig": {"HeaderBehavior": "whitelist"}},
            {**origin, "CookiesConfig": {"CookieBehavior": "none"}},
            {**origin, "QueryStringsConfig": {"QueryStringBehavior": "none"}},
        ]:
            with patch.object(deploy, "aws", side_effect=responses(cache, wrong)):
                with self.assertRaisesRegex(RuntimeError, "forwarding all viewer"):
                    deploy.verify_cloudfront_policies()

    def test_policy_lookup_failure_prevents_change_set_and_template_validation(self):
        for lock in [False, True]:
            with patch.object(deploy, "approved"), patch.object(
                deploy,
                "verify_cloudfront_policies",
                side_effect=RuntimeError("Policy lookup404"),
            ), patch.object(deploy, "aws") as fake:
                with self.assertRaisesRegex(RuntimeError, "lookup404"):
                    deploy.change_set(argparse.Namespace(), lock=lock)
                fake.assert_not_called()
        with patch("sys.argv", ["deploy.py", "validate"]), patch.object(
            deploy, "identity"
        ), patch.object(
            deploy,
            "verify_cloudfront_policies",
            side_effect=RuntimeError("Policy lookup404"),
        ), patch.object(
            deploy, "aws"
        ) as fake:
            with self.assertRaisesRegex(RuntimeError, "lookup404"):
                deploy.main()
            fake.assert_not_called()

    def test_archive_uses_exact_commit_excluding_dirty_files_and_untracked_env(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "repo"
            root.mkdir()
            subprocess.run(["git", "init", "--quiet", str(root)], check=True)
            (root / "deploy/aws").mkdir(parents=True)
            (root / "deploy/aws/instance.py").write_text(
                "# synthetic committed helper\n"
            )
            (root / "app.txt").write_text("committed source\n")
            (root / ".gitignore").write_text(".env\n")
            subprocess.run(["git", "-C", str(root), "add", "."], check=True)
            subprocess.run(
                [
                    "git",
                    "-C",
                    str(root),
                    "-c",
                    "user.name=Synthetic",
                    "-c",
                    "user.email=synthetic@example.invalid",
                    "commit",
                    "--quiet",
                    "-m",
                    "Synthetic fixture",
                ],
                check=True,
            )
            sha = subprocess.check_output(
                ["git", "-C", str(root), "rev-parse", "HEAD"], text=True
            ).strip()
            (root / "app.txt").write_text("uncommitted content\n")
            (root / ".env").write_text("UNRELATED_SECRET=synthetic-do-not-copy\n")
            file = Path(directory) / "source.tar"
            with patch.object(deploy, "ROOT", root):
                actual, digest = deploy.archive(sha, file)
            self.assertEqual(actual, sha)
            self.assertEqual(len(digest), 64)
            with tarfile.open(file) as archive:
                self.assertNotIn(".env", archive.getnames())
                self.assertEqual(
                    archive.extractfile("app.txt").read(), b"committed source\n"
                )

    def test_template_creates_no_shared_network_public_ip_ssh_or_remote_sqlite(self):
        resources = self.template["Resources"]
        forbidden = {
            "AWS::EC2::VPC",
            "AWS::EC2::Subnet",
            "AWS::EC2::Route",
            "AWS::EC2::NatGateway",
            "AWS::EC2::EIP",
            "AWS::EFS::FileSystem",
        }
        self.assertFalse(forbidden.intersection(r["Type"] for r in resources.values()))
        props = resources["Instance"]["Properties"]
        self.assertEqual(props["CreditSpecification"]["CPUCredits"], "standard")
        self.assertEqual(props["MetadataOptions"]["HttpTokens"], "required")
        self.assertEqual(props["MetadataOptions"]["HttpPutResponseHopLimit"], 1)
        self.assertFalse(props["NetworkInterfaces"][0]["AssociatePublicIpAddress"])
        self.assertNotIn("KeyName", props)
        root = props["BlockDeviceMappings"][0]["Ebs"]
        self.assertEqual((root["VolumeSize"], root["Encrypted"]), (30, True))
        volume = resources["DataVolume"]
        self.assertEqual(volume["Condition"], "NewDataVolume")
        self.assertEqual(
            (volume["DeletionPolicy"], volume["UpdateReplacePolicy"]),
            ("RetainExceptOnCreate", "Retain"),
        )
        self.assertEqual(
            (volume["Properties"]["Size"], volume["Properties"]["Encrypted"]),
            (10, True),
        )
        self.assertEqual(
            resources["DataAttachment"]["Properties"]["VolumeId"]["Fn::If"],
            ["NewDataVolume", {"Ref": "DataVolume"}, {"Ref": "ExistingDataVolumeId"}],
        )

    def test_origin_ingress_bootstraps_then_locks_and_never_allows_vpc_cidr(self):
        resources = self.template["Resources"]
        bootstrap = resources["BootstrapOriginIngress"]
        locked = resources["LockedOriginIngress"]
        self.assertEqual(
            (bootstrap["Condition"], locked["Condition"]),
            ("BootstrapIngress", "LockedIngress"),
        )
        for rule in [bootstrap["Properties"], locked["Properties"]]:
            self.assertEqual((rule["FromPort"], rule["ToPort"]), (8080, 8080))
            self.assertNotIn("CidrIp", rule)
            self.assertNotIn("CidrIpv6", rule)
        self.assertIn("SourcePrefixListId", bootstrap["Properties"])
        self.assertIn("SourceSecurityGroupId", locked["Properties"])
        self.assertNotIn(
            "SecurityGroupIngress", resources["OriginSecurityGroup"]["Properties"]
        )

    def test_cloudfront_forwards_identity_and_disables_every_route_cache(self):
        config = self.template["Resources"]["Distribution"]["Properties"][
            "DistributionConfig"
        ]
        behavior = config["DefaultCacheBehavior"]
        self.assertEqual(behavior["ViewerProtocolPolicy"], "redirect-to-https")
        self.assertEqual(
            behavior["CachePolicyId"], "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
        )
        self.assertEqual(
            behavior["OriginRequestPolicyId"], "216adef6-5c7f-47e4-b989-5492eafa07d3"
        )
        self.assertEqual(
            set(behavior["AllowedMethods"]),
            {"GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"},
        )
        self.assertNotIn("CacheBehaviors", config)
        self.assertTrue(
            all(e["ErrorCachingMinTTL"] == 0 for e in config["CustomErrorResponses"])
        )
        self.assertEqual(
            {e["ErrorCode"] for e in config["CustomErrorResponses"]},
            {400, 403, 404, 405, 414, 500, 501, 502, 503, 504},
        )
        self.assertTrue(config["ViewerCertificate"]["CloudFrontDefaultCertificate"])

    def test_instance_role_cannot_read_other_projects_parameter_values(self):
        policies = self.template["Resources"]["InstanceRole"]["Properties"]["Policies"]
        statements = policies[0]["PolicyDocument"]["Statement"]
        deny = next(s for s in statements if s["Effect"] == "Deny")
        self.assertEqual(
            set(deny["Action"]),
            {
                "ssm:GetParameter",
                "ssm:GetParameters",
                "ssm:GetParametersByPath",
                "ssm:GetParameterHistory",
            },
        )
        allowed = json.dumps(deny["NotResource"])
        self.assertIn("OPENAI_API_KEY", allowed)
        self.assertIn("QLOO_API_KEY", allowed)
        self.assertNotIn("parameter/*", allowed)
        self.assertNotIn("ssm:PutParameter", json.dumps(statements))

    def test_userdata_has_no_runtime_values_and_is_valid_shell(self):
        userdata = self.template["Resources"]["Instance"]["Properties"]["UserData"][
            "Fn::Base64"
        ]["Fn::Join"][1]
        text = "\n".join(userdata)
        self.assertNotIn("OPENAI_API_KEY", text)
        self.assertNotIn("QLOO_API_KEY", text)
        self.assertNotIn("get-parameters", text)
        self.assertIn("sha256sum --check --status", text)
        checked = subprocess.run(
            ["bash", "-n"], input=text, capture_output=True, text=True
        )
        self.assertEqual(checked.returncode, 0, checked.stderr)

    def test_exact_volume_serial_refuses_device_order_root_or_ambiguity(self):
        listing = "/dev/nvme0n1 volroot disk\n/dev/nvme2n1 vol0123456789abcdef0 disk\n/dev/nvme1n1 volother disk\n"
        self.assertEqual(
            instance.device_for_volume("vol-0123456789abcdef0", listing), "/dev/nvme2n1"
        )
        for bad in [
            listing.replace("vol0123456789abcdef0", "volforeign"),
            "/dev/xvdf vol0123456789abcdef0 disk",
            listing + "/dev/nvme3n1 vol0123456789abcdef0 disk\n",
            "/dev/nvme2n1 vol0123456789abcdef0 part",
        ]:
            with self.subTest(listing=bad), self.assertRaises(RuntimeError):
                instance.device_for_volume("vol-0123456789abcdef0", bad)

    def test_manifest_binds_source_volume_public_origin_and_private_interface(self):
        sha = "a" * 40
        value = {
            "version": 1,
            "commit": sha,
            "volume": "vol-0123",
            "source": "/var/lib/tastip/releases/" + sha + "/source",
            "private_ip": "10.40.3.10",
            "origin": "https://d123abc.cloudfront.net",
            "parameter_prefix": "/tastip-demo",
        }
        self.assertIs(instance.validate(value), value)
        for change in [
            {"commit": "HEAD"},
            {"source": "/tmp/other"},
            {"volume": "/dev/nvme0n1"},
            {"origin": "http://d123abc.cloudfront.net"},
            {"origin": "https://foreign.example"},
            {"private_ip": "1.1.1.1"},
            {"private_ip": "127.0.0.1"},
            {"private_ip": "0.0.0.0"},
            {"parameter_prefix": "/other-project"},
        ]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                instance.validate({**value, **change})

    def test_runtime_fetches_only_two_securestrings_and_never_puts_values_in_argv(self):
        prefix = "/tastip-demo/"
        secrets = {
            "OPENAI_API_KEY": "synthetic-openai-12345",
            "QLOO_API_KEY": "synthetic-qloo-12345",
        }
        response = {
            "Parameters": [
                {"Name": prefix + k, "Type": "SecureString", "Value": v}
                for k, v in secrets.items()
            ]
        }
        with tempfile.TemporaryDirectory() as directory, patch.object(
            instance, "RUNTIME", Path(directory)
        ), patch.object(
            instance, "MOUNT", Path(directory) / "synthetic-mount"
        ), patch.object(
            instance,
            "command",
            return_value=argparse.Namespace(stdout=json.dumps(response)),
        ) as fake:
            instance.runtime(
                {
                    "parameter_prefix": "/tastip-demo",
                    "origin": "https://d123abc.cloudfront.net",
                    "commit": "a" * 40,
                    "private_ip": "10.40.3.10",
                }
            )
            args = fake.call_args.args[0]
            self.assertTrue(all(v not in " ".join(args) for v in secrets.values()))
            self.assertIn("--with-decryption", args)
            file = Path(directory) / "runtime.env"
            self.assertEqual(file.stat().st_mode & 0o777, 0o600)
            text = file.read_text()
            self.assertIn("TASTIP_APP_ORIGIN=https://d123abc.cloudfront.net", text)
            self.assertIn("TASTIP_ENABLE_HOSTED_PROVIDERS=1", text)
            self.assertIn("TASTIP_GLOBAL_PROVIDER_LIMIT=200", text)
            for name, value in secrets.items():
                self.assertIn(name + "=" + value, text)
            configuration = (Path(directory) / "compose.env").read_text()
            self.assertIn("TASTIP_IMAGE=tastip:" + "a" * 40, configuration)
            self.assertIn("TASTIP_PROXY_IMAGE=tastip-proxy:" + "a" * 40, configuration)

    def test_missing_or_plaintext_parameter_stops_before_creating_runtime_files(self):
        for response in [
            {"InvalidParameters": ["/tastip-demo/QLOO_API_KEY"]},
            {
                "Parameters": [
                    {
                        "Name": "/tastip-demo/" + k,
                        "Type": "String",
                        "Value": "synthetic-only",
                    }
                    for k in keys.NAMES
                ]
            },
        ]:
            with tempfile.TemporaryDirectory() as directory, patch.object(
                instance, "RUNTIME", Path(directory)
            ), patch.object(
                instance, "MOUNT", Path(directory) / "synthetic-mount"
            ), patch.object(
                instance,
                "command",
                return_value=argparse.Namespace(stdout=json.dumps(response)),
            ):
                with self.assertRaises(RuntimeError):
                    instance.runtime({"parameter_prefix": "/tastip-demo"})
                self.assertEqual(list(Path(directory).iterdir()), [])

    def test_key_parser_selects_only_two_names_and_rejects_ambiguous_inputs(self):
        text = "OTHER_PRIVATE_KEY=must-not-upload\nexport OPENAI_API_KEY='synthetic-openai-12345'\nQLOO_API_KEY=synthetic-qloo-12345 # ignored comment\n"
        self.assertEqual(
            keys.selected_keys(text),
            {
                "OPENAI_API_KEY": "synthetic-openai-12345",
                "QLOO_API_KEY": "synthetic-qloo-12345",
            },
        )
        for invalid in [
            text + "QLOO_API_KEY=duplicate-key\n",
            "OPENAI_API_KEY=only-one-key",
            text.replace("synthetic-openai-12345", "$(do-not-execute)"),
        ]:
            with self.subTest(value=invalid), self.assertRaises(ValueError):
                keys.selected_keys(invalid)

    def test_key_upload_uses_private_input_file_and_never_secret_arguments_or_output(
        self,
    ):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / ".env"
            source.write_text(
                "OPENAI_API_KEY=synthetic-openai-12345\nQLOO_API_KEY=synthetic-qloo-12345\nUNRELATED_SECRET=do-not-copy\n"
            )
            captured = []

            def fake(args, **kwargs):
                file = Path(
                    args[args.index("--cli-input-json") + 1].removeprefix("file://")
                )
                self.assertEqual(file.stat().st_mode & 0o777, 0o600)
                payload = json.loads(file.read_text())
                self.assertNotIn(payload["Value"], " ".join(args))
                self.assertNotIn("--value", args)
                self.assertEqual(payload["Type"], "SecureString")
                self.assertFalse(payload["Overwrite"])
                captured.append(payload["Name"])
                return argparse.Namespace(returncode=0)

            output = io.StringIO()
            argv = [
                "keys.py",
                "--file",
                str(source),
                "--approved-account",
                deploy.expected_account(),
            ]
            with patch("sys.argv", argv), patch.object(keys, "approved"), patch.object(
                keys, "allowed_file", return_value=source
            ), patch.object(
                keys.subprocess, "run", side_effect=fake
            ), contextlib.redirect_stdout(
                output
            ):
                keys.main()
            self.assertEqual(
                set(captured),
                {"/tastip-demo/OPENAI_API_KEY", "/tastip-demo/QLOO_API_KEY"},
            )
            self.assertNotIn("synthetic-", output.getvalue())
            self.assertNotIn("do-not-copy", output.getvalue())


class MapsRuntimeSafety(unittest.TestCase):
    value = {
        "version": 1,
        "commit": "a" * 40,
        "volume": "vol-0123",
        "origin": "https://d123abc.cloudfront.net",
        "parameter_prefix": "/tastip-demo",
        "private_ip": "10.40.3.10",
    }
    key = "syntheticMapsKey_12345"

    def config_file(self, mount, value):
        parent = mount / "config"
        parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        file = parent / "maps-public.json"
        file.write_text(json.dumps(value))
        file.chmod(0o600)
        return file

    def owned_stat(self, *, parent_uid=0, file_uid=0):
        # Tests never chown or inspect a real deployment. Only synthetic fd metadata
        # is presented as root-owned so these contracts run as an ordinary user.
        actual = os.fstat

        def snapshot(fd):
            info = actual(fd)
            fields = list(info)
            fields[4] = parent_uid if stat.S_ISDIR(info.st_mode) else file_uid
            return os.stat_result(fields)

        return patch.object(instance.os, "fstat", side_effect=snapshot)

    def fake_keys(self):
        return argparse.Namespace(
            stdout=json.dumps(
                {
                    "Parameters": [
                        {
                            "Name": "/tastip-demo/" + name,
                            "Type": "SecureString",
                            "Value": "synthetic-" + name,
                        }
                        for name in ["OPENAI_API_KEY", "QLOO_API_KEY"]
                    ]
                }
            )
        )

    def test_absent_maps_file_explicitly_disables_and_clears_stale_runtime_or_env_key(
        self,
    ):
        for parent_exists in [False, True]:
            with self.subTest(
                parent_exists=parent_exists
            ), tempfile.TemporaryDirectory() as directory:
                mount = Path(directory) / "mount"
                runtime = Path(directory) / "runtime"
                runtime.mkdir(mode=0o700)
                (runtime / "runtime.env").write_text(
                    "TASTIP_ENABLE_GOOGLE_MAPS=1\nGOOGLE_MAPS_BROWSER_KEY=stale-key\n"
                )
                if parent_exists:
                    (mount / "config").mkdir(mode=0o700, parents=True)
                with patch.object(instance, "MOUNT", mount), patch.object(
                    instance, "RUNTIME", runtime
                ), self.owned_stat(), patch.dict(
                    os.environ,
                    {
                        "TASTIP_ENABLE_GOOGLE_MAPS": "1",
                        "GOOGLE_MAPS_BROWSER_KEY": "injected-env-key",
                    },
                ), patch.object(
                    instance, "command", return_value=self.fake_keys()
                ) as fake:
                    instance.runtime(self.value)
                text = (runtime / "runtime.env").read_text()
                self.assertIn(
                    "TASTIP_ENABLE_GOOGLE_MAPS=0\nGOOGLE_MAPS_BROWSER_KEY=\n", text
                )
                self.assertNotIn("stale-key", text)
                self.assertNotIn("injected-env-key", text)
                args = fake.call_args.args[0]
                names = args[
                    args.index("--names") + 1 : args.index("--with-decryption")
                ]
                self.assertEqual(
                    names, ["/tastip-demo/OPENAI_API_KEY", "/tastip-demo/QLOO_API_KEY"]
                )

    def test_enabled_and_disabled_maps_files_have_only_explicit_bounded_runtime_values(
        self,
    ):
        for enabled in [False, True]:
            with self.subTest(
                enabled=enabled
            ), tempfile.TemporaryDirectory() as directory:
                mount = Path(directory) / "mount"
                runtime = Path(directory) / "runtime"
                file = self.config_file(mount, {"enabled": enabled, "apiKey": self.key})
                original = file.read_bytes()
                output = io.StringIO()
                with patch.object(instance, "MOUNT", mount), patch.object(
                    instance, "RUNTIME", runtime
                ), self.owned_stat(), patch.object(
                    instance, "command", return_value=self.fake_keys()
                ) as fake, contextlib.redirect_stdout(
                    output
                ), contextlib.redirect_stderr(
                    output
                ):
                    instance.runtime(self.value)
                text = (runtime / "runtime.env").read_text()
                self.assertIn(
                    "TASTIP_ENABLE_GOOGLE_MAPS=" + ("1" if enabled else "0") + "\n",
                    text,
                )
                self.assertIn(
                    "GOOGLE_MAPS_BROWSER_KEY=" + (self.key if enabled else "") + "\n",
                    text,
                )
                self.assertNotIn(self.key, " ".join(fake.call_args.args[0]))
                self.assertEqual(output.getvalue(), "")
                self.assertEqual(file.read_bytes(), original)
                self.assertEqual(
                    (runtime / "runtime.env").stat().st_mode & 0o777, 0o600
                )
        with tempfile.TemporaryDirectory() as directory:
            mount = Path(directory)
            self.config_file(mount, {"enabled": False, "apiKey": ""})
            with patch.object(instance, "MOUNT", mount), self.owned_stat():
                self.assertEqual(instance.maps_runtime_config(), (False, ""))

    def assert_invalid(self, mount, directory, ownership=None):
        runtime = Path(directory) / "runtime"
        runtime.mkdir(mode=0o700, exist_ok=True)
        before = {
            "runtime.env": b"old runtime bytes\n",
            "compose.env": b"old compose bytes\n",
        }
        for name, value in before.items():
            (runtime / name).write_bytes(value)
        with patch.object(instance, "MOUNT", mount), patch.object(
            instance, "RUNTIME", runtime
        ), ownership or self.owned_stat(), patch.object(instance, "command") as fake:
            with self.assertRaisesRegex(
                RuntimeError, "Invalid private Maps runtime configuration"
            ) as error:
                instance.runtime(self.value)
            self.assertNotIn(self.key, str(error.exception))
            fake.assert_not_called()
        self.assertEqual(
            {name: (runtime / name).read_bytes() for name in before}, before
        )

    def test_malformed_unknown_duplicate_or_unsafe_values_never_clobber_existing_runtime(
        self,
    ):
        bad = [
            "{",
            "null",
            "[]",
            json.dumps({"enabled": True}),
            json.dumps({"enabled": True, "apiKey": self.key, "extra": True}),
            json.dumps({"enabled": 1, "apiKey": self.key}),
            json.dumps({"enabled": "true", "apiKey": self.key}),
            json.dumps({"enabled": True, "apiKey": None}),
            json.dumps({"enabled": True, "apiKey": ""}),
            json.dumps({"enabled": True, "apiKey": "x" * 257}),
            '{"enabled":false,"enabled":true,"apiKey":"' + self.key + '"}',
            json.dumps({"enabled": True, "apiKey": self.key}) + " " * 2048,
        ] + [
            json.dumps({"enabled": False, "apiKey": key})
            for key in ["a b", "a\nb", "a\tb", "a\0b", "$(synthetic)", "key=extra"]
        ]
        for text in bad:
            with self.subTest(
                text=text[:60]
            ), tempfile.TemporaryDirectory() as directory:
                mount = Path(directory) / "mount"
                file = self.config_file(mount, {"enabled": False, "apiKey": ""})
                file.write_text(text)
                self.assert_invalid(mount, directory)
        with tempfile.TemporaryDirectory() as directory:
            mount = Path(directory) / "mount"
            file = self.config_file(mount, {"enabled": False, "apiKey": ""})
            file.write_bytes(b"\xff\xfeinvalid")
            self.assert_invalid(mount, directory)

    def test_wrong_owner_or_permissions_fail_without_key_reads_or_runtime_replacement(
        self,
    ):
        for parent_uid, file_uid, parent_mode, file_mode in [
            (1000, 0, 0o700, 0o600),
            (0, 1000, 0o700, 0o600),
            (0, 0, 0o755, 0o600),
            (0, 0, 0o700, 0o644),
            (0, 0, 0o1700, 0o600),
            (0, 0, 0o700, 0o4600),
        ]:
            with self.subTest(
                parent_uid=parent_uid,
                file_uid=file_uid,
                parent_mode=parent_mode,
                file_mode=file_mode,
            ), tempfile.TemporaryDirectory() as directory:
                mount = Path(directory) / "mount"
                file = self.config_file(mount, {"enabled": True, "apiKey": self.key})
                file.parent.chmod(parent_mode)
                file.chmod(file_mode)
                self.assert_invalid(
                    mount,
                    directory,
                    self.owned_stat(parent_uid=parent_uid, file_uid=file_uid),
                )

    def test_symlink_parents_files_and_nonregular_files_are_rejected_without_blocking(
        self,
    ):
        for kind in ["parent", "file", "directory", "fifo"]:
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as directory:
                mount = Path(directory) / "mount"
                file = self.config_file(mount, {"enabled": True, "apiKey": self.key})
                if kind == "parent":
                    actual = mount / "elsewhere"
                    file.parent.rename(actual)
                    (mount / "config").symlink_to(actual, target_is_directory=True)
                else:
                    file.unlink()
                    if kind == "file":
                        target = mount / "target.json"
                        target.write_text(
                            json.dumps({"enabled": True, "apiKey": self.key})
                        )
                        file.symlink_to(target)
                    elif kind == "directory":
                        file.mkdir(mode=0o600)
                    else:
                        os.mkfifo(file, mode=0o600)
                self.assert_invalid(mount, directory)

    def test_start_and_release_validate_maps_after_mount_and_before_stopping_old_app(
        self,
    ):
        order = []
        with patch.object(
            instance, "mount_data", side_effect=lambda *_: order.append("mount")
        ), patch.object(
            instance, "runtime", side_effect=RuntimeError("invalid config")
        ), patch.object(
            instance, "compose"
        ) as compose:
            with self.assertRaisesRegex(RuntimeError, "invalid config"):
                instance.start(self.value)
            self.assertEqual(order, ["mount"])
            compose.assert_not_called()
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory).resolve() / "state"
            mount = Path(directory) / "mount"
            runtime = Path(directory) / "runtime"
            source = state / "releases" / self.value["commit"] / "source"
            helper = source / "deploy/aws/instance.py"
            helper.parent.mkdir(parents=True)
            helper.write_text("# synthetic source helper")
            current = state / "current.json"
            current.write_text("synthetic old manifest bytes")
            file = self.config_file(mount, {"enabled": True, "apiKey": self.key})
            file.write_text("invalid JSON")
            with patch.object(instance, "STATE", state), patch.object(
                instance, "MOUNT", mount
            ), patch.object(instance, "RUNTIME", runtime), patch.object(
                instance, "__file__", str(helper)
            ), self.owned_stat(), patch.object(
                instance, "mount_data"
            ) as mounted, patch.object(
                instance, "smoke", return_value="{}"
            ), patch.object(
                instance, "smoke_proxy", return_value="synthetic proxy"
            ), patch.object(
                instance.subprocess,
                "run",
                return_value=argparse.Namespace(returncode=0),
            ), patch.object(
                instance, "command"
            ) as command, patch.object(
                instance, "compose"
            ) as compose:
                with self.assertRaisesRegex(
                    RuntimeError, "Invalid private Maps runtime configuration"
                ):
                    instance.release({**self.value, "source": str(source)}, False)
                mounted.assert_called_once()
                command.assert_not_called()
                compose.assert_not_called()
            self.assertEqual(current.read_text(), "synthetic old manifest bytes")
            self.assertFalse(runtime.exists())


if __name__ == "__main__":
    unittest.main()
