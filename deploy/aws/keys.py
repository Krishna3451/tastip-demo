#!/usr/bin/env python3
"""Upload only two runtime keys from an ignored local file, after explicit approval.

No key values are placed in argv, printed, or passed to CloudFormation/SSM commands.
"""
import argparse
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import tempfile

from deploy import approved, expected_account, project

NAMES = {"OPENAI_API_KEY", "QLOO_API_KEY"}


def selected_keys(text):
    if len(text.encode()) > 1024 * 1024:
        raise ValueError("Environment file exceeds 1MB")
    found = {}
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("export "):
            stripped = stripped[7:].lstrip()
        name, separator, value = stripped.partition("=")
        if not separator or name.strip() not in NAMES:
            continue
        name = name.strip()
        if name in found:
            raise ValueError(
                "Selected runtime key is repeated; remove ambiguity locally"
            )
        parts = shlex.split(value, comments=True, posix=True)
        if len(parts) != 1 or not re.fullmatch(r"[A-Za-z0-9_./:+-]{8,512}", parts[0]):
            raise ValueError(
                "Selected runtime key format is invalid; no value was logged"
            )
        found[name] = parts[0]
    if set(found) != NAMES:
        raise ValueError("Both OPENAI_API_KEY and QLOO_API_KEY must be present")
    return found


def allowed_file(path):
    path = path.resolve(strict=True)
    if not path.is_file() or path.stat().st_size > 1024 * 1024:
        raise ValueError("Choose a bounded regular ignored environment file")
    # Check against its own repository (also works for a different Tastip worktree).
    result = subprocess.run(
        ["git", "-C", str(path.parent), "rev-parse", "--show-toplevel"],
        capture_output=True,
        text=True,
    )
    if result.returncode == 0:
        root = Path(result.stdout.strip())
        check = subprocess.run(
            ["git", "-C", str(root), "check-ignore", "--quiet", "--", str(path)],
            capture_output=True,
        )
        tracked = subprocess.run(
            ["git", "-C", str(root), "ls-files", "--error-unmatch", "--", str(path)],
            capture_output=True,
        )
        if check.returncode != 0 or tracked.returncode == 0:
            raise ValueError("File inside a Git checkout must be ignored and untracked")
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", type=project, default="tastip-demo")
    parser.add_argument("--file", required=True, type=Path)
    parser.add_argument("--approved-account")
    parser.add_argument(
        "--replace-existing",
        action="store_true",
        help="Explicitly rotate both already-created parameters",
    )
    args = parser.parse_args()
    # Approval/identity happen before reading any local key file.
    approved(args)
    values = selected_keys(allowed_file(args.file).read_text())
    with tempfile.TemporaryDirectory(prefix="tastip-key-input-") as directory:
        os.chmod(directory, 0o700)
        file = Path(directory) / "input.json"
        for name in sorted(NAMES):
            payload = {
                "Name": "/" + args.project + "/" + name,
                "Type": "SecureString",
                "Tier": "Standard",
                "Value": values[name],
                "Overwrite": args.replace_existing,
            }
            if not args.replace_existing:
                payload["Tags"] = [{"Key": "Project", "Value": "Tastip"}]
            fd = os.open(file, os.O_CREAT | os.O_TRUNC | os.O_WRONLY, 0o600)
            with os.fdopen(fd, "w") as stream:
                json.dump(payload, stream)
            # Protected JSON file, never --value or a secret-valued command argument.
            result = subprocess.run(
                [
                    "aws",
                    "--profile",
                    "own",
                    "--region",
                    "ap-south-1",
                    "--no-cli-pager",
                    "ssm",
                    "put-parameter",
                    "--cli-input-json",
                    "file://" + str(file),
                    "--output",
                    "json",
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            file.unlink()
            if result.returncode:
                raise RuntimeError(
                    "SecureString upload failed; inspect parameter existence/permissions without printing values. A previous selected key may already have been stored."
                )
    print(
        "Stored only the two selected runtime keys as Standard SecureString parameters in account "
        + expected_account()
        + "."
    )


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, OSError) as error:
        raise SystemExit(str(error)) from None
