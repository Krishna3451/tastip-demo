# Optional AWS deployment

Parameterized tooling for a dedicated EC2/EBS app behind a CloudFront private VPC origin. Provisioning, source/key upload and release are separate commands; this document does not provision resources.

Use AWS CLI v2 and Python 3.9+ locally. Every local AWS operation is pinned to profile
`own` and region `ap-south-1`. Set the required `TASTIP_AWS_EXPECTED_ACCOUNT` to the
independently reviewed 12-digit account ID. The scripts reject a missing/malformed
expected ID before calling AWS, then check STS and reject another account. The scripts
never fall back to the `default` profile. Keep actual account/network IDs in a private
local plan rather than this public runbook.
No local AWS credentials are copied to the instance. Its IAM role supplies credentials.

## Architecture and scope

One `t3.medium` Linux/amd64 EC2 instance builds the exact committed Git archive with
the existing pinned Dockerfile. It has **no public IP or SSH ingress**, uses SSM, and
requires IMDSv2 with response hop limit 1. CPU credits use `standard` to avoid surplus
credit charges. A private, encrypted S3 bucket holds source archives; this avoids an
additional registry and local Docker daemon dependency. Source and logs stay private.

The instance reuses an explicitly selected existing NAT-backed private subnet. It
creates a Tastip-only security group and never edits shared VPC routes, NAT, subnets,
security groups or existing applications. Supply the reviewed VPC and subnet IDs
explicitly; `plan` discovers the attached NAT and AWS-managed CloudFront prefix list.
Prefer a private subnet in the existing NAT's AZ to avoid cross-AZ transfer charges.
Keep that candidate selection in an owner-only local plan outside Git.

Shared-network reuse is an explicit operational dependency: the existing NAT/routes
must remain available. The read-only `plan`
checks subnet/VPC, NAT route/state, attached internet gateway and available addresses.
It does not claim to verify every existing NACL or deployment permission.

CloudFront supplies a stable default `https://…cloudfront.net` URL and its certificate.
A VPC origin reaches EC2 privately on port 8080; no ALB, new NAT, public IPv4, domain,
ACM certificate or EFS is created. The proxy binds only the EC2 private interface and
accepts only the exact distribution Host. It sets HTTPS forwarding itself. All viewer
headers (including Origin, Referer, Sec-Fetch-Site and X-Tastip-Account), cookies and
query strings reach Next. CloudFront's managed **CachingDisabled** policy applies to
every route, with zero error-cache TTL for upstream failures. This prioritizes account
isolation over asset-cache savings during the demo.

AWS documents two supported VPC-origin ingress methods. Phase one admits only the
AWS-managed CloudFront origin-facing prefix list on 8080 (its quota weight is 55).
After CloudFront creates its service-managed SG, `lock-origin` prepares a second
change set replacing that bootstrap rule with a reference to that actual managed SG.
The script never creates or modifies an SG named `CloudFront-VPCOrigins-Service-SG…`.
It refuses ambiguous discovery. The app cannot be released until phase two is complete.
There is no broad VPC CIDR ingress and no SSH rule. Outbound HTTPS uses the existing NAT.

The root disk is encrypted gp3 30 GB. SQLite has its own encrypted gp3 10 GB EBS volume
mounted on `/srv/tastip`, with `/srv/tastip/data` bound to the UID/GID 1000 container's
`/data`. A newly created data volume uses **RetainExceptOnCreate**: if its creating
stack operation rolls back, CloudFormation can delete the unused disk; later stack
deletion/removal retains it. **UpdateReplacePolicy: Retain** preserves an old disk
when replacement occurs. An explicitly adopted `ExistingDataVolumeId` is not created
or governed by the conditional new-volume resource; these policies never authorize
deleting that adopted disk. A volume
is identified by the exact reviewed EBS ID in its Nitro disk serial, never `/dev/sdf`
ordering. First-use formatting requires `--initialize-blank-volume`, no partitions,
no existing filesystem/signatures and a matching serial. Existing filesystems are not
reformatted. A wrong disk, nonempty mount point or wrong existing owner stops startup.
SQLite WAL uses this one local block filesystem; never mount its live files on EFS/NFS.

## Costs

EC2, retained EBS/S3, CloudFront, logs, snapshots and provider APIs can incur separate charges. Review current regional pricing and set billing monitoring before provisioning. There is no automatic spending ceiling or shutdown. Stop/delete resources when finished; retained storage remains billed.

## Review and provision

From the repository root, these perform read-only discovery/validation or offline tests:

```sh
export TASTIP_AWS_EXPECTED_ACCOUNT='REVIEWED_12_DIGIT_ACCOUNT_ID'
export TASTIP_AWS_VPC_ID='REVIEWED_VPC_ID'
export TASTIP_AWS_PRIVATE_SUBNET_ID='REVIEWED_PRIVATE_SUBNET_ID'
python3 deploy/aws/deploy.py validate
python3 deploy/aws/deploy.py plan \
  --vpc "$TASTIP_AWS_VPC_ID" \
  --subnet "$TASTIP_AWS_PRIVATE_SUBNET_ID"
python3 -m unittest discover -s deploy/aws -p 'test_*.py' -v
```

The following steps **write AWS state** and can incur charges. Use an account/network you control, pin its expected account ID, and inspect each change set before execution.

`validate` and both creation/lock change-set helpers also resolve the referenced
CloudFront policies through live read-only API calls before continuing: the cache
policy must be named `Managed-CachingDisabled` with all three TTLs zero, and the
origin policy must be `Managed-AllViewer` forwarding all viewer headers, cookies
and query strings. A missing policy ID or unexpected setting fails closed before
any change set is created. CloudFormation `ValidateTemplate` alone checks neither
that lookup nor effective managed-policy settings.

1. Commit/review the source and these deployment files. Prepare a change set:

   ```sh
   python3 deploy/aws/deploy.py change-set \
     --vpc "$TASTIP_AWS_VPC_ID" \
     --subnet "$TASTIP_AWS_PRIVATE_SUBNET_ID" \
     --approved-account "$TASTIP_AWS_EXPECTED_ACCOUNT"
   ```

2. Independently inspect it with `aws cloudformation describe-change-set --profile own
   --region ap-south-1 --stack-name tastip-demo --change-set-name REVIEWED_CHANGE_SET`.
   Confirm no shared resources, unexpected replacements or public IP/SSH/NAT. Then:

   ```sh
   python3 deploy/aws/deploy.py execute --change-set REVIEWED_CHANGE_SET \
     --approved-account "$TASTIP_AWS_EXPECTED_ACCOUNT"
   ```

   Monitor stack events to successful completion; VPC-origin creation can take 15
   minutes. Account permissions must allow CloudFront's VPC-origin service-linked
   role/ENIs as well as the listed CloudFormation resources. Check SSM registration
   and `/var/lib/tastip/logs/bootstrap.log` before proceeding. Bootstrap downloads
   Compose v2.39.4 with its pinned release SHA-256, and starts no application.

3. Run `lock-origin`, review its returned change set, then separately `execute` it:

   ```sh
   python3 deploy/aws/deploy.py lock-origin \
     --approved-account "$TASTIP_AWS_EXPECTED_ACCOUNT"
   ```

   Verify bootstrap prefix-list ingress is gone and the only inbound rule is 8080
   from the actual AWS-managed CloudFront VPC-origin SG. Do not modify that managed SG.

## Supply only the runtime keys

SecureString is not supported by `AWS::SSM::Parameter`. Keys therefore never enter
CloudFormation parameters, UserData, build arguments, source archives or SSM command
bodies. The dedicated helper reads **only** OPENAI_API_KEY and QLOO_API_KEY from the
owner's ignored, untracked local environment file after its account/approval check:

```sh
python3 deploy/aws/keys.py --file /absolute/path/to/ignored/.env \
  --approved-account "$TASTIP_AWS_EXPECTED_ACCOUNT"
```

No key is passed using a `--value` argument or printed. The helper constructs an
owner-only temporary CLI-input JSON file outside Git, uploads each Standard
SecureString under `/tastip-demo/KEY_NAME`, then removes it. Default replacement is
disabled. If a partial upload fails, inspect **names/types**, not values; explicit
`--replace-existing` rotates both. It uses AWS-managed `alias/aws/ssm`; the instance
role explicitly denies parameter-value reads outside these two names, overriding
the broader parameter reads in AmazonSSMManagedInstanceCore. For a stricter long-term
separation, review a customer-managed KMS key and its extra cost before replacing it.

The instance retrieves these two SecureStrings into memory at startup, verifies their
types/formats, and creates root-only files under `/run/tastip` for Compose. They are
recreated after reboot rather than committed or stored in UserData. Docker root/host
administrators can inspect container environment; keep SSM/admin access restricted.
Do not run `docker inspect`, `docker compose config`, or `ssm get-parameters
--with-decryption` into shared logs. The deployed service receives its two runtime
keys through this SecureString path; key values stay outside source and public proof.

## Exact-source build and release

1. Upload a reviewed **committed** source SHA. `git archive` excludes ignored/untracked
   files, and an additional path guard rejects tracked environment/private data files.
   The source bucket is private, encrypted, versioned and retained.

   ```sh
   python3 deploy/aws/deploy.py upload --commit REVIEWED_FULL_COMMIT_SHA \
     --approved-account "$TASTIP_AWS_EXPECTED_ACCOUNT"
   ```

2. Copy the exact returned full commit and SHA-256 into a separately reviewed release:

   ```sh
   python3 deploy/aws/deploy.py release --commit REVIEWED_FULL_COMMIT_SHA \
     --sha256 RETURNED_ARCHIVE_SHA256 --initialize-blank-volume \
     --approved-account "$TASTIP_AWS_EXPECTED_ACCOUNT"
   ```

   Omit `--initialize-blank-volume` for all later releases or restored data volumes.
   This sends one nonsecret SSM command. It downloads the private archive, verifies
   SHA-256, extracts a new private directory, builds the app and capability-free proxy images on Linux/amd64 **without
   build arguments or keys**, and runs network-disabled, non-app smoke checks: Node 24,
   UID 1000, in-memory SQLite, standalone server/static assets and Caddy execution with all capabilities dropped. Build output
   is root-only at `/var/lib/tastip/logs/FULL_COMMIT.build.log`.

3. Inspect SSM `get-command-invocation` status/output and the returned image ID, commit,
   smoke proof and backup location. The 120-second delivery timeout and 3600-second
   execution limit are separate; do not resend a timed-out command blindly. An
   existing release directory is never overwritten. A failed build leaves an old
   app running; inspect/remove only the failed Tastip release after review before
   retrying its same SHA. No prune/system-wide cleanup is automatic.

4. After a good image and configuration check, the helper mounts the dedicated disk,
   stops the old app, copies the entire stopped SQLite directory (including any WAL)
   with ownership preserved, and starts the candidate with health checks. A failed
   candidate is stopped, its data preserved under `failed-*`, and the matching prior
   data snapshot is restored before the old image restarts. Backups are **not deleted
   automatically**. Insufficient backup space fails before interrupting a live app.
   Root-only `current.json` / `previous.json` record nonsecret release manifests.

5. Successful releases install a root-owned systemd oneshot service. On reboot it
   verifies/remounts the volume, fetches the two keys and starts the same image.
   The AWS override uses bounded `on-failure:3` container restarts, which do not
   auto-start on Docker daemon reboot; this prevents a container racing the data
   mount/key check. The oneshot is a boot/stop controller, not a health supervisor;
   exhausted crash retries require an operator to inspect and restart the service. The
   public distribution origin is discovered only after stack creation, then passed
   as a nonsecret exact runtime value; this avoids a CloudFormation dependency cycle.
   Fixed internal origin is `https://0.0.0.0:3000`. The app's existing session/account,
   CSRF and durable quota gates remain required. A guest cannot invoke paid providers.

## Backup, rollback and teardown

Updates retain a matching stopped-app copy of the complete data directory before
replacing the image. For an off-instance backup, create an EBS snapshot while the app
is stopped through SSM, wait for completion, and restart it. Tag snapshots
`Project=Tastip`; record snapshot, volume ID, AZ and source SHA together. Snapshot
creation/retention incurs additional cost and is not automatic. Local stopped-app copies are not off-instance backups; test restoring a separate copy before relying on recovery.

For manual rollback, use SSM to stop `tastip`, preserve current data under a new
recovery name, restore the matching stopped-app backup with `cp -a`, and restore the
matching prior `current.json` plus systemd helper path. Restart `tastip` and verify
health, sign-in and a second-account isolation check. Do not run an old image against
an unreviewed newer SQLite schema. Do not delete failed data or old images until the
rollback is verified. Test same-image restore, reboot and any older-image/schema rollback separately before relying on them.

For instance replacement or disaster recovery, first preserve a snapshot and stop
the old writer. Explicitly supply `--existing-volume vol-…` in the same AZ to a
reviewed new change set; the helper checks encrypted/Tastip-tagged/available status.
A snapshot-restored volume must also be tagged before adoption. Never attach the
same SQLite disk to concurrent writers. CloudFront VPC-origin updates may require
disassociation/reassociation; do not treat instance replacement as zero downtime.

At the approved end time, stop the service and instance if pausing, or review/delete
the Tastip stack after disabling/draining its CloudFront distribution. Data EBS and
source bucket remain retained (and billed); snapshots and two SecureStrings also
remain until explicit reviewed deletion. Shared VPC/NAT/routes are untouched.
Retained volumes/buckets are not automatically re-imported into a fresh stack.

## References

- [VPC origins: Mumbai support, private-subnet/IGW/SG requirements and feature limits](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-vpc-origins.html).
- [CloudFormation VpcOrigin resource](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-cloudfront-vpcorigin.html) and [endpoint settings](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-cloudfront-vpcorigin-vpcoriginendpointconfig.html).
- [CloudFront origin-facing prefix list](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/LocationsOfEdgeServers.html) and [AllViewer origin request policy](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-origin-request-policies.html).
- [CachingDisabled managed policy ID and zero TTL settings](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-cache-policies.html).
- [VPC origins have no additional feature charge](https://aws.amazon.com/cloudfront/faqs/), [EC2 pricing](https://aws.amazon.com/ec2/pricing/on-demand/) and [EBS pricing](https://aws.amazon.com/ebs/pricing/).
- [CloudFormation does not support SecureString parameters](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ssm-parameter.html) and [SecureString/KMS behavior](https://docs.aws.amazon.com/systems-manager/latest/userguide/secure-string-parameter-kms-encryption.html).
- [Docker restart-policy behavior](https://docs.docker.com/engine/containers/start-containers-automatically/).
- [CloudFormation RetainExceptOnCreate and Retain semantics](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-attribute-deletionpolicy.html).
