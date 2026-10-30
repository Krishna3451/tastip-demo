#!/usr/bin/env python3
"""Root-only SSM/systemd deployment helper. Never run this on a developer machine."""
import argparse
import fcntl
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import time

STATE = Path("/var/lib/tastip")
MOUNT = Path("/srv/tastip")
RUNTIME = Path("/run/tastip")
REGION = "ap-south-1"


def command(args, *, check=True, stdout=subprocess.PIPE):
    result = subprocess.run(args, stdout=stdout, stderr=subprocess.PIPE, text=True)
    if check and result.returncode:
        # Runtime keys must never reach SSM output or systemd's journal.
        raise RuntimeError("Deployment command failed: " + Path(args[0]).name)
    return result


def private_file(path, value):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".new")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w") as file:
            file.write(value)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def validate(value):
    if (
        value.get("version") != 1
        or not re.fullmatch(r"[a-f0-9]{40}", value.get("commit", ""))
        or not re.fullmatch(r"vol-[a-f0-9]+", value.get("volume", ""))
    ):
        raise ValueError("Invalid exact release/volume manifest")
    if not re.fullmatch(
        r"https://[a-z0-9]+\.cloudfront\.net", value.get("origin", "")
    ) or not re.fullmatch(
        r"/tastip-[a-z0-9-]{1,24}", value.get("parameter_prefix", "")
    ):
        raise ValueError("Invalid public origin or parameter prefix")
    address = ipaddress.IPv4Address(value["private_ip"])
    if not any(
        address in ipaddress.IPv4Network(network)
        for network in ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]
    ):
        raise ValueError("Proxy must bind a private IPv4 address")
    expected = str(STATE / "releases" / value["commit"] / "source")
    if value.get("source") != expected:
        raise ValueError("Manifest source must be the exact private release directory")
    return value


def read_manifest(path):
    return validate(json.loads(path.read_text()))


def device_for_volume(volume, listing):
    expected = volume.replace("-", "")
    matches = []
    for line in listing.splitlines():
        fields = line.split()
        if (
            len(fields) == 3
            and fields[1].replace("-", "") == expected
            and fields[2] == "disk"
            and re.fullmatch(r"/dev/nvme[0-9]+n[0-9]+", fields[0])
        ):
            matches.append(fields[0])
    if len(matches) != 1:
        raise RuntimeError(
            "Cannot identify one Nitro block device by the exact EBS volume serial; refusing device-name fallback"
        )
    return matches[0]


def mount_data(value, initialize=False):
    listing = command(
        ["lsblk", "--nodeps", "--noheadings", "--output", "PATH,SERIAL,TYPE"]
    ).stdout
    device = device_for_volume(value["volume"], listing)
    root = command(
        ["findmnt", "--noheadings", "--output", "SOURCE", "/"]
    ).stdout.strip()
    if Path(root).resolve() == Path(device).resolve():
        raise RuntimeError("Refusing the root disk")
    if command(["mountpoint", "--quiet", str(MOUNT)], check=False).returncode == 0:
        mounted = command(
            [
                "findmnt",
                "--noheadings",
                "--output",
                "SOURCE",
                "--mountpoint",
                str(MOUNT),
            ]
        ).stdout.strip()
        if Path(mounted).resolve() != Path(device).resolve():
            raise RuntimeError(
                "Private mount already belongs to a different block device"
            )
    else:
        # Never hide preexisting files under a new mount or format a partitioned/signed disk.
        if MOUNT.exists() and any(MOUNT.iterdir()):
            raise RuntimeError("Mount point contains files; inspect manually")
        kinds = command(
            ["lsblk", "--noheadings", "--output", "TYPE", device]
        ).stdout.split()
        if kinds != ["disk"]:
            raise RuntimeError("Expected an unpartitioned dedicated data disk")
        filesystem = command(
            ["blkid", "--output", "value", "--match-tag", "TYPE", device], check=False
        ).stdout.strip()
        if not filesystem:
            signatures = json.loads(
                command(["wipefs", "--no-act", "--json", device]).stdout
            ).get("signatures", [])
            if signatures or not initialize:
                raise RuntimeError(
                    "Blank data disk requires explicit first-use initialization; existing signatures are never overwritten"
                )
            command(["mkfs.ext4", "-L", "tastip-data", device])
        elif filesystem != "ext4":
            raise RuntimeError(
                "Only the existing ext4 data filesystem is supported; nothing was reformatted"
            )
        MOUNT.mkdir(mode=0o700, parents=True, exist_ok=True)
        command(["mount", "-o", "nodev,nosuid,noexec", device, str(MOUNT)])
    os.chmod(MOUNT, 0o700)
    data = MOUNT / "data"
    if data.is_symlink():
        raise RuntimeError("Private data directory must not be a symlink")
    if not data.exists():
        data.mkdir(mode=0o700)
        os.chown(data, 1000, 1000)
    if data.stat().st_uid != 1000 or data.stat().st_gid != 1000:
        raise RuntimeError(
            "Existing private data ownership differs from container UID/GID 1000"
        )
    os.chmod(data, 0o700)


def maps_runtime_config():
    """Optional root-owned public Maps settings; never source shell/environment text."""

    def private(info, kind, mode):
        if (
            not kind(info.st_mode)
            or info.st_uid != 0
            or stat.S_IMODE(info.st_mode) != mode
        ):
            raise ValueError("Invalid Maps config permissions")

    def unique_fields(pairs):
        if len({name for name, _ in pairs}) != len(pairs):
            raise ValueError("Duplicate Maps config fields")
        return dict(pairs)

    try:
        try:
            parent = os.open(
                MOUNT / "config", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
            )
        except FileNotFoundError:
            return False, ""
        try:
            private(os.fstat(parent), stat.S_ISDIR, 0o700)
            try:
                descriptor = os.open(
                    "maps-public.json",
                    os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                    dir_fd=parent,
                )
            except FileNotFoundError:
                return False, ""
            with os.fdopen(descriptor, "rb") as file:
                info = os.fstat(file.fileno())
                private(info, stat.S_ISREG, 0o600)
                if info.st_size > 2048:
                    raise ValueError("Oversized Maps config")
                raw = file.read(2049)
                if len(raw) > 2048:
                    raise ValueError("Oversized Maps config")
        finally:
            os.close(parent)
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=unique_fields)
        if (
            not isinstance(value, dict)
            or set(value) != {"enabled", "apiKey"}
            or type(value["enabled"]) is not bool
            or not isinstance(value["apiKey"], str)
            or not re.fullmatch(r"[A-Za-z0-9_-]{0,256}", value["apiKey"])
            or (value["enabled"] and not value["apiKey"])
        ):
            raise ValueError("Invalid Maps config fields")
        return value["enabled"], value["apiKey"] if value["enabled"] else ""
    except (OSError, ValueError, RecursionError):
        # No contents, decoder details or key values in SSM output/journald.
        raise RuntimeError("Invalid private Maps runtime configuration") from None


def runtime(value):
    # mount_data already ran. Fail before fetching keys, replacing runtime files,
    # or stopping the existing release when a present Maps config is invalid.
    maps_enabled, maps_key = maps_runtime_config()
    names = [
        value["parameter_prefix"] + "/" + k for k in ["OPENAI_API_KEY", "QLOO_API_KEY"]
    ]
    result = command(
        [
            "aws",
            "--region",
            REGION,
            "ssm",
            "get-parameters",
            "--names",
            *names,
            "--with-decryption",
            "--output",
            "json",
            "--no-cli-pager",
        ]
    )
    response = json.loads(result.stdout)
    keys = {p["Name"]: p for p in response.get("Parameters", [])}
    if response.get("InvalidParameters") or set(keys) != set(names):
        raise RuntimeError("Both dedicated SecureString keys must exist before startup")
    lines = []
    for name in names:
        item = keys[name]
        if item["Type"] != "SecureString" or not re.fullmatch(
            r"[A-Za-z0-9_./:+-]{8,512}", item["Value"]
        ):
            raise RuntimeError(
                "Runtime key has an unsupported format; no key value was logged"
            )
        lines.append(name.rsplit("/", 1)[1] + "=" + item["Value"])
    RUNTIME.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(RUNTIME, 0o700)
    private_file(
        RUNTIME / "runtime.env",
        "\n".join(
            [
                "TASTIP_APP_ORIGIN=" + value["origin"],
                "TASTIP_ENABLE_HOSTED_PROVIDERS=1",
                "TASTIP_ENABLE_GOOGLE_MAPS=" + ("1" if maps_enabled else "0"),
                "GOOGLE_MAPS_BROWSER_KEY=" + maps_key,
                "TASTIP_DAILY_PROVIDER_LIMIT=50",
                "TASTIP_GLOBAL_PROVIDER_LIMIT=200",
                "OPENAI_CHAT_MODEL=gpt-5-mini",
                "OPENAI_REALTIME_MODEL=gpt-realtime-2.1",
                *lines,
                "",
            ]
        ),
    )
    private_file(
        RUNTIME / "compose.env",
        "\n".join(
            [
                "TASTIP_IMAGE=tastip:" + value["commit"],
                "TASTIP_PROXY_IMAGE=tastip-proxy:" + value["commit"],
                "TASTIP_RUNTIME_ENV_FILE=" + str(RUNTIME / "runtime.env"),
                "TASTIP_DATA_HOST_DIR=" + str(MOUNT / "data"),
                "TASTIP_FORWARDED_PROTO=https",
                "TASTIP_PRIVATE_IP=" + value["private_ip"],
                "TASTIP_PUBLIC_HOST=" + value["origin"].removeprefix("https://"),
                "",
            ]
        ),
    )


def compose(value, *args):
    source = Path(value["source"])
    return command(
        [
            "docker",
            "compose",
            "--project-name",
            value["parameter_prefix"][1:],
            "--env-file",
            str(RUNTIME / "compose.env"),
            "-f",
            str(source / "deploy/compose.yaml"),
            "-f",
            str(source / "deploy/aws/compose.override.yaml"),
            *args,
        ]
    )


def start(value):
    mount_data(value)
    runtime(value)
    compose(value, "up", "--detach", "--no-build", "--wait", "--wait-timeout", "180")


def smoke(image):
    script = """const fs=require('node:fs');if(process.getuid()!==1000||!process.version.startsWith('v24.'))throw Error('runtime');fs.accessSync('/app/apps/web/server.js');if(!fs.readdirSync('/app/apps/web/.next/static').length)throw Error('static');const{DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(':memory:');if(db.prepare('select 7 as n').get().n!==7)throw Error('sqlite');db.close();console.log(JSON.stringify({node:process.version,uid:process.getuid(),sqlite:'memory-only',server:true,static:true}));"""
    return command(
        [
            "docker",
            "run",
            "--rm",
            "--network",
            "none",
            "--read-only",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
            "--no-healthcheck",
            "--entrypoint",
            "node",
            image,
            "-e",
            script,
        ]
    ).stdout.strip()


def smoke_proxy(image):
    return command(
        [
            "docker",
            "run",
            "--rm",
            "--network",
            "none",
            "--read-only",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
            "--entrypoint",
            "sh",
            image,
            "-ec",
            'test -z "$(getcap /usr/bin/caddy)"; caddy version',
        ]
    ).stdout.strip()


def release(value, initialize):
    validate(value)
    source = Path(value["source"])
    if Path(__file__).resolve() != source / "deploy/aws/instance.py":
        raise RuntimeError("Run the helper from the exact extracted source archive")
    image = "tastip:" + value["commit"]
    proxy_image = "tastip-proxy:" + value["commit"]
    log = STATE / "logs" / (value["commit"] + ".build.log")
    log.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with open(log, "x") as stream:
        os.chmod(log, 0o600)
        for dockerfile, tag in [
            ("Dockerfile", image),
            ("deploy/proxy.Dockerfile", proxy_image),
        ]:
            result = subprocess.run(
                [
                    "docker",
                    "build",
                    "--progress=plain",
                    "--file",
                    str(source / dockerfile),
                    "--tag",
                    tag,
                    str(source),
                ],
                stdout=stream,
                stderr=subprocess.STDOUT,
            )
            if result.returncode:
                raise RuntimeError("Image build failed; private log " + str(log))
    proof = smoke(image)
    proxy_proof = smoke_proxy(proxy_image)
    mount_data(value, initialize)
    # Verify protected configuration before interrupting an existing deployment.
    runtime(value)
    current = STATE / "current.json"
    previous = read_manifest(current) if current.exists() else None
    used = int(
        command(["du", "--summarize", "--bytes", str(MOUNT / "data")]).stdout.split()[0]
    )
    if shutil.disk_usage(MOUNT).free < used + 128 * 1024 * 1024:
        raise RuntimeError(
            "Insufficient data EBS space for a stopped-app backup; existing release remains running"
        )
    if previous:
        command(["systemctl", "stop", "tastip"])
        compose(previous, "down", "--remove-orphans")
    stamp = str(int(time.time()))
    backup = MOUNT / "backups" / (stamp + "-before-" + value["commit"][:12])
    backup.parent.mkdir(mode=0o700, exist_ok=True)
    backup.mkdir(mode=0o700)
    # The app is stopped: preserve DB + WAL/SHM together, including UID ownership.
    try:
        command(["cp", "-a", str(MOUNT / "data"), str(backup / "data")])
    except RuntimeError:
        if previous:
            start(previous)
            command(["systemctl", "start", "tastip"])
        raise RuntimeError("Backup failed; existing data was not replaced") from None
    try:
        compose(
            value, "up", "--detach", "--no-build", "--wait", "--wait-timeout", "180"
        )
    except RuntimeError:
        compose(value, "down", "--remove-orphans")
        # Keep failed writes for recovery before restoring the matching old snapshot.
        failed = MOUNT / ("failed-" + stamp + "-" + value["commit"][:12])
        os.rename(MOUNT / "data", failed)
        command(["cp", "-a", str(backup / "data"), str(MOUNT / "data")])
        if previous:
            start(previous)
            command(["systemctl", "start", "tastip"])
        raise RuntimeError(
            "Release health failed; old data restored, failed data retained at "
            + str(failed)
        ) from None
    if previous:
        private_file(STATE / "previous.json", json.dumps(previous))
    private_file(current, json.dumps(value))
    helper = str(source / "deploy/aws/instance.py")
    unit = "\n".join(
        [
            "[Unit]",
            "Description=Tastip private single-node demo",
            "Requires=docker.service",
            "After=network-online.target docker.service",
            "Wants=network-online.target",
            "",
            "[Service]",
            "Type=oneshot",
            "RemainAfterExit=yes",
            "UMask=0077",
            "TimeoutStartSec=300",
            "TimeoutStopSec=90",
            "ExecStart=/usr/bin/python3 " + helper + " start",
            "ExecStop=/usr/bin/python3 " + helper + " stop",
            "",
            "[Install]",
            "WantedBy=multi-user.target",
            "",
        ]
    )
    private_file(Path("/etc/systemd/system/tastip.service"), unit)
    command(["systemctl", "daemon-reload"])
    command(["systemctl", "enable", "--now", "tastip"])
    image_id = command(
        ["docker", "image", "inspect", image, "--format", "{{.Id}}"]
    ).stdout.strip()
    proxy_id = command(
        ["docker", "image", "inspect", proxy_image, "--format", "{{.Id}}"]
    ).stdout.strip()
    print(
        json.dumps(
            {
                "commit": value["commit"],
                "image": image_id,
                "proxyImage": proxy_id,
                "proxySmoke": proxy_proof,
                "smoke": json.loads(proof),
                "buildLog": str(log),
                "backup": str(backup),
                "origin": value["origin"],
            }
        )
    )


def main():
    if os.geteuid() != 0:
        raise RuntimeError(
            "This helper is for the reviewed EC2 instance via SSM, as root"
        )
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="operation", required=True)
    for name in ["start", "stop"]:
        commands.add_parser(name)
    child = commands.add_parser("release")
    for name in ["commit", "volume", "private-ip", "origin", "parameter-prefix"]:
        child.add_argument("--" + name, required=True)
    child.add_argument("--initialize-blank-volume", action="store_true")
    args = parser.parse_args()
    if args.operation == "release":
        value = {
            "version": 1,
            "commit": args.commit,
            "volume": args.volume,
            "private_ip": args.private_ip,
            "origin": args.origin,
            "parameter_prefix": args.parameter_prefix,
            "source": str(STATE / "releases" / args.commit / "source"),
        }
        # Different SSM commands must never deploy two writers concurrently.
        with open(STATE / "deploy.lock", "a") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise RuntimeError(
                    "Another Tastip release is already running"
                ) from None
            release(value, args.initialize_blank_volume)
    else:
        value = read_manifest(STATE / "current.json")
        if args.operation == "start":
            start(value)
        else:
            compose(value, "down", "--remove-orphans")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, KeyError, OSError) as error:
        raise SystemExit(str(error)) from None
