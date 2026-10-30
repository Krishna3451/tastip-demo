#!/bin/sh
set -eu
umask 077
# /data is the sole durable store. Fail startup instead of silently using a fallback DB.
if [ "${TASTIP_DATA_DIR:-}" != /data ]; then
  echo 'TASTIP_DATA_DIR must be /data in this container.' >&2
  exit 1
fi
tastip_data_mounted=false
while IFS=' ' read -r tastip_mount_id tastip_parent tastip_device tastip_root tastip_mountpoint tastip_rest; do
  if [ "$tastip_mountpoint" = /data ]; then
    tastip_data_mounted=true
    break
  fi
done < /proc/self/mountinfo
if [ "$tastip_data_mounted" != true ]; then
  echo 'Mount the dedicated private data volume at /data before starting Tastip.' >&2
  exit 1
fi
chmod 700 /data
if [ ! -w /data ]; then
  echo 'The private data volume must be writable by UID 1000.' >&2
  exit 1
fi
exec "$@"
