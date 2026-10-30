#!/usr/bin/env python3
"""Explicit AWS deployment operations. With no arguments, print help and do nothing."""
import argparse
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import tempfile
import time

PROFILE = "own"
REGION = "ap-south-1"
ROOT = Path(__file__).resolve().parents[2]
TEMPLATE = ROOT / "deploy/aws/template.json"


def run(args, *, input=None):
    result = subprocess.run(args, input=input, capture_output=True, text=True)
    if result.returncode:
        # Never echo argv or stdout: a caller may be handling a protected response.
        raise RuntimeError(result.stderr.strip() or "Command failed")
    return result.stdout


def aws(*args):
    value = run(
        [
            "aws",
            "--profile",
            PROFILE,
            "--region",
            REGION,
            "--no-cli-pager",
            *args,
            "--output",
            "json",
        ]
    )
    return json.loads(value) if value.strip() else {}


def expected_account():
    value = os.environ.get("TASTIP_AWS_EXPECTED_ACCOUNT", "")
    if not re.fullmatch(r"[0-9]{12}", value):
        raise RuntimeError(
            "Set TASTIP_AWS_EXPECTED_ACCOUNT to the independently reviewed 12-digit account ID"
        )
    return value


def identity():
    expected = expected_account()
    actual = aws("sts", "get-caller-identity")
    if actual.get("Account") != expected:
        raise RuntimeError(
            "Refusing AWS access: profile own is not the reviewed account"
        )
    return actual


def approved(args):
    identity()
    expected = expected_account()
    if args.approved_account != expected:
        raise RuntimeError(
            "This operation writes AWS state. Complete review/budget approval, then pass --approved-account "
            + expected
        )


def project(value):
    if not re.fullmatch(r"tastip-[a-z0-9-]{1,24}", value):
        raise argparse.ArgumentTypeError(
            "Use tastip- followed by 1–24 lowercase letters, digits or hyphens"
        )
    return value


def verify_cloudfront_policies():
    """Validate referenced live managed policies; template syntax cannot resolve IDs."""
    config = json.loads(TEMPLATE.read_text())["Resources"]["Distribution"][
        "Properties"
    ]["DistributionConfig"]["DefaultCacheBehavior"]
    cache = aws("cloudfront", "get-cache-policy", "--id", config["CachePolicyId"])[
        "CachePolicy"
    ]["CachePolicyConfig"]
    if cache.get("Name") != "Managed-CachingDisabled" or any(
        cache.get(name) != 0 for name in ["MinTTL", "DefaultTTL", "MaxTTL"]
    ):
        raise RuntimeError(
            "CloudFront cache policy must be live Managed-CachingDisabled with all three TTLs zero"
        )
    request = aws(
        "cloudfront",
        "get-origin-request-policy",
        "--id",
        config["OriginRequestPolicyId"],
    )["OriginRequestPolicy"]["OriginRequestPolicyConfig"]
    if (
        request.get("Name") != "Managed-AllViewer"
        or request.get("HeadersConfig", {}).get("HeaderBehavior") != "allViewer"
        or request.get("CookiesConfig", {}).get("CookieBehavior") != "all"
        or request.get("QueryStringsConfig", {}).get("QueryStringBehavior") != "all"
    ):
        raise RuntimeError(
            "CloudFront origin policy must be live Managed-AllViewer forwarding all viewer headers, cookies and query strings"
        )


def network(args):
    identity()
    vpcs = aws("ec2", "describe-vpcs", "--vpc-ids", args.vpc)["Vpcs"]
    subnet = aws("ec2", "describe-subnets", "--subnet-ids", args.subnet)["Subnets"][0]
    if not vpcs or subnet["VpcId"] != args.vpc or subnet.get("MapPublicIpOnLaunch"):
        raise RuntimeError(
            "Select the explicit existing private subnet in the supplied VPC"
        )
    routes = aws(
        "ec2", "describe-route-tables", "--filters", "Name=vpc-id,Values=" + args.vpc
    )["RouteTables"]
    chosen = [
        r
        for r in routes
        if any(a.get("SubnetId") == args.subnet for a in r["Associations"])
    ]
    chosen = chosen or [
        r for r in routes if any(a.get("Main") for a in r["Associations"])
    ]
    nat_ids = [
        r["NatGatewayId"]
        for table in chosen
        for r in table["Routes"]
        if r.get("DestinationCidrBlock") == "0.0.0.0/0"
        and r.get("State") == "active"
        and r.get("NatGatewayId")
    ]
    if len(nat_ids) != 1:
        raise RuntimeError(
            "Subnet must already have one active NAT default route; this template never changes routes"
        )
    nat = aws("ec2", "describe-nat-gateways", "--nat-gateway-ids", nat_ids[0])[
        "NatGateways"
    ][0]
    if nat["State"] != "available":
        raise RuntimeError("Existing NAT is not available")
    gateways = aws(
        "ec2",
        "describe-internet-gateways",
        "--filters",
        "Name=attachment.vpc-id,Values=" + args.vpc,
    )["InternetGateways"]
    if not gateways or subnet["AvailableIpAddressCount"] < 2:
        raise RuntimeError(
            "VPC origin requires an attached IGW and free private IPv4 addresses"
        )
    prefixes = aws(
        "ec2",
        "describe-managed-prefix-lists",
        "--filters",
        "Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing",
    )["PrefixLists"]
    if len(prefixes) != 1 or prefixes[0]["OwnerId"] != "AWS":
        raise RuntimeError("Cannot identify the AWS-managed origin-facing prefix list")
    if args.existing_volume:
        volume = aws("ec2", "describe-volumes", "--volume-ids", args.existing_volume)[
            "Volumes"
        ][0]
        if (
            volume["AvailabilityZone"] != subnet["AvailabilityZone"]
            or volume["State"] != "available"
            or not volume["Encrypted"]
            or not any(
                t["Key"] == "Project" and t["Value"] == "Tastip"
                for t in volume.get("Tags", [])
            )
        ):
            raise RuntimeError(
                "Existing data volume must be available, encrypted, Tastip-tagged and in the selected AZ"
            )
    return {
        "vpc": args.vpc,
        "subnet": args.subnet,
        "az": subnet["AvailabilityZone"],
        "existingNat": nat_ids[0],
        "prefixList": prefixes[0]["PrefixListId"],
    }


def parameters(args, selected):
    values = {
        "ProjectName": args.project,
        "VpcId": args.vpc,
        "PrivateSubnetId": args.subnet,
        "CloudFrontPrefixListId": selected["prefixList"],
        "InstanceType": args.instance_type,
        "ExistingDataVolumeId": args.existing_volume,
    }
    return [{"ParameterKey": k, "ParameterValue": v} for k, v in values.items()]


def outputs(stack):
    data = aws("cloudformation", "describe-stacks", "--stack-name", stack)["Stacks"][0]
    if (
        not data["StackStatus"].endswith("_COMPLETE")
        or "ROLLBACK" in data["StackStatus"]
    ):
        raise RuntimeError("Stack is not in a successful complete state")
    return data, {o["OutputKey"]: o["OutputValue"] for o in data["Outputs"]}


def change_set(args, *, lock=False):
    approved(args)
    verify_cloudfront_policies()
    if lock:
        stack, out = outputs(args.project)
        values = {
            p["ParameterKey"]: p.get("ParameterValue", "") for p in stack["Parameters"]
        }
        groups = aws(
            "ec2",
            "describe-security-groups",
            "--filters",
            "Name=vpc-id,Values=" + values["VpcId"],
            "Name=group-name,Values=CloudFront-VPCOrigins-Service-SG*",
        )["SecurityGroups"]
        if len(groups) != 1 or groups[0]["OwnerId"] != expected_account():
            raise RuntimeError(
                "Expected exactly one AWS-managed CloudFront VPC origins SG in the selected VPC; inspect manually"
            )
        params = [
            {"ParameterKey": p["ParameterKey"], "UsePreviousValue": True}
            for p in stack["Parameters"]
            if p["ParameterKey"] != "CloudFrontServiceSecurityGroupId"
        ]
        params.append(
            {
                "ParameterKey": "CloudFrontServiceSecurityGroupId",
                "ParameterValue": groups[0]["GroupId"],
            }
        )
        kind = "UPDATE"
    else:
        selected = network(args)
        params = parameters(args, selected)
        kind = "UPDATE" if args.update else "CREATE"
        if args.update:
            # Preserve the tightened SG and the AMI; an ordinary update must not reopen bootstrap ingress.
            params.extend(
                {"ParameterKey": k, "UsePreviousValue": True}
                for k in ["CloudFrontServiceSecurityGroupId", "LatestAmiId"]
            )
    name = ("lock-origin-" if lock else "review-") + str(int(time.time()))
    response = aws(
        "cloudformation",
        "create-change-set",
        "--stack-name",
        args.project,
        "--change-set-name",
        name,
        "--change-set-type",
        kind,
        "--template-body",
        "file://" + str(TEMPLATE),
        "--parameters",
        json.dumps(params),
        "--capabilities",
        "CAPABILITY_IAM",
        "--tags",
        "Key=Project,Value=Tastip",
        "Key=Environment,Value=demo",
    )
    print(
        json.dumps(
            {
                "changeSet": response["Id"],
                "next": "Review describe-change-set; execute is a separate explicit operation.",
            },
            indent=2,
        )
    )


def check_release_paths(paths):
    for value in paths:
        path = Path(value)
        if any(
            p
            in {
                ".data",
                "data",
                "backups",
                "node_modules",
                ".git",
                "test-results",
                "playwright-report",
            }
            for p in path.parts
        ) or any(
            (p.startswith(".env") and p != ".env.example")
            or p.endswith((".sqlite", ".db", ".pem", ".key", ".p12", ".pfx"))
            for p in path.parts
        ):
            raise RuntimeError(
                "Source archive contains a forbidden private/generated path"
            )


def archive(commit, destination):
    sha = run(
        ["git", "-C", str(ROOT), "rev-parse", "--verify", commit + "^{commit}"]
    ).strip()
    paths = run(
        ["git", "-C", str(ROOT), "ls-tree", "-r", "--name-only", sha]
    ).splitlines()
    check_release_paths(paths)
    # The reviewed deployment tools must be committed in the exact source archive.
    if "deploy/aws/instance.py" not in paths:
        raise RuntimeError(
            "Commit the reviewed AWS tooling before creating a release archive"
        )
    with open(destination, "wb") as file:
        result = subprocess.run(
            ["git", "-C", str(ROOT), "archive", "--format=tar", sha],
            stdout=file,
            stderr=subprocess.PIPE,
        )
    if result.returncode:
        raise RuntimeError("git archive failed")
    digest = hashlib.sha256()
    with open(destination, "rb") as file:
        for block in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(block)
    return sha, digest.hexdigest()


def upload(args):
    approved(args)
    _, out = outputs(args.project)
    with tempfile.TemporaryDirectory(prefix="tastip-source-") as directory:
        os.chmod(directory, 0o700)
        file = Path(directory) / "source.tar"
        sha, digest = archive(args.commit, file)
        aws(
            "s3api",
            "put-object",
            "--bucket",
            out["SourceBucket"],
            "--key",
            "releases/" + sha + ".tar",
            "--body",
            str(file),
            "--server-side-encryption",
            "AES256",
            "--metadata",
            json.dumps({"commit": sha, "sha256": digest}),
        )
    print(
        json.dumps(
            {
                "commit": sha,
                "sha256": digest,
                "bucket": out["SourceBucket"],
                "key": "releases/" + sha + ".tar",
            },
            indent=2,
        )
    )


def release(args):
    approved(args)
    stack, out = outputs(args.project)
    params = {
        p["ParameterKey"]: p.get("ParameterValue", "") for p in stack["Parameters"]
    }
    if not params.get("CloudFrontServiceSecurityGroupId"):
        raise RuntimeError("Execute the lock-origin change set before starting the app")
    if not re.fullmatch(r"[a-f0-9]{40}", args.commit) or not re.fullmatch(
        r"[a-f0-9]{64}", args.sha256
    ):
        raise RuntimeError("Supply the exact upload result commit and sha256")
    host = out["PublicOrigin"].removeprefix("https://")
    if not re.fullmatch(r"[a-z0-9]+\.cloudfront\.net", host):
        raise RuntimeError("Unexpected public distribution hostname")
    ipaddress.IPv4Address(out["PrivateIp"])
    target = "/var/lib/tastip/releases/" + args.commit
    quoted = shlex.quote
    script = "\n".join(
        [
            "set -eu",
            "umask 077",
            "test -x /usr/local/lib/docker/cli-plugins/docker-compose",
            "install -d -m 0700 /var/lib/tastip/releases /var/lib/tastip/logs",
            "test ! -e " + quoted(target),
            "mkdir -m 0700 " + quoted(target),
            "aws --region "
            + REGION
            + " s3 cp "
            + quoted(
                "s3://" + out["SourceBucket"] + "/releases/" + args.commit + ".tar"
            )
            + " "
            + quoted(target + "/source.tar")
            + " --only-show-errors",
            "printf '%s  %s\\n' "
            + quoted(args.sha256)
            + " "
            + quoted(target + "/source.tar")
            + " | sha256sum --check --status",
            "mkdir -m 0700 " + quoted(target + "/source"),
            "tar -xf "
            + quoted(target + "/source.tar")
            + " -C "
            + quoted(target + "/source"),
            "python3 "
            + quoted(target + "/source/deploy/aws/instance.py")
            + " release --commit "
            + args.commit
            + " --volume "
            + quoted(out["DataVolumeId"])
            + " --private-ip "
            + quoted(out["PrivateIp"])
            + " --origin "
            + quoted(out["PublicOrigin"])
            + " --parameter-prefix "
            + quoted(out["ParameterPrefix"])
            + (" --initialize-blank-volume" if args.initialize_blank_volume else ""),
        ]
    )
    response = aws(
        "ssm",
        "send-command",
        "--instance-ids",
        out["InstanceId"],
        "--document-name",
        "AWS-RunShellScript",
        "--timeout-seconds",
        "120",
        "--parameters",
        json.dumps({"commands": [script], "executionTimeout": ["3600"]}),
        "--comment",
        "Tastip exact-source build and reviewed release " + args.commit[:12],
    )
    print(
        json.dumps(
            {
                "commandId": response["Command"]["CommandId"],
                "instanceId": out["InstanceId"],
                "publicOrigin": out["PublicOrigin"],
                "note": "Monitor SSM invocation status; app starts only after build, image smoke, private mount and key validation.",
            },
            indent=2,
        )
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command")
    for name in ["plan", "change-set"]:
        child = commands.add_parser(name)
        child.add_argument("--project", type=project, default="tastip-demo")
        child.add_argument("--vpc", required=True)
        child.add_argument("--subnet", required=True)
        child.add_argument(
            "--instance-type", choices=["t3.small", "t3.medium"], default="t3.medium"
        )
        child.add_argument("--existing-volume", default="")
        if name == "change-set":
            child.add_argument("--update", action="store_true")
            child.add_argument("--approved-account")
    commands.add_parser("validate")
    for name in ["execute", "lock-origin", "upload", "release"]:
        child = commands.add_parser(name)
        child.add_argument("--project", type=project, default="tastip-demo")
        child.add_argument("--approved-account")
        if name == "execute":
            child.add_argument("--change-set", required=True)
        if name in ["upload", "release"]:
            child.add_argument("--commit", required=True)
        if name == "release":
            child.add_argument("--sha256", required=True)
            child.add_argument("--initialize-blank-volume", action="store_true")
    args = parser.parse_args()
    if args.command == "plan":
        selected = network(args)
        print(
            json.dumps(
                {
                    "account": expected_account(),
                    "profile": PROFILE,
                    "region": REGION,
                    "existingNetwork": selected,
                    "parameters": parameters(args, selected),
                    "newResources": "one private EC2 + 30GB encrypted root + 10GB retained encrypted data + private source S3 + IAM/SG + CloudFront VPCOrigin/distribution",
                    "estimated730HourBaseUSD": (
                        36.352 if args.instance_type == "t3.medium" else 20.0
                    ),
                    "excludes": "existing NAT, transfer, CloudFront, source storage, snapshots, provider usage and tax",
                    "writesPerformed": False,
                },
                indent=2,
            )
        )
    elif args.command == "validate":
        identity()
        verify_cloudfront_policies()
        print(
            json.dumps(
                aws(
                    "cloudformation",
                    "validate-template",
                    "--template-body",
                    "file://" + str(TEMPLATE),
                ),
                indent=2,
            )
        )
    elif args.command == "change-set":
        change_set(args)
    elif args.command == "lock-origin":
        change_set(args, lock=True)
    elif args.command == "execute":
        approved(args)
        review = aws(
            "cloudformation",
            "describe-change-set",
            "--stack-name",
            args.project,
            "--change-set-name",
            args.change_set,
        )
        if (
            review["Status"] != "CREATE_COMPLETE"
            or review["ExecutionStatus"] != "AVAILABLE"
        ):
            raise RuntimeError(
                "Change set must be available and independently reviewed"
            )
        aws(
            "cloudformation",
            "execute-change-set",
            "--stack-name",
            args.project,
            "--change-set-name",
            args.change_set,
        )
        print(
            "Requested execution. Monitor stack events; no later operation is automatic."
        )
    elif args.command == "upload":
        upload(args)
    elif args.command == "release":
        release(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, KeyError, ValueError, OSError) as error:
        raise SystemExit(str(error)) from None
