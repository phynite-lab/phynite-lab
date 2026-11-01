"""Disk-backed local storage budget; no hosted billing or plan policy."""
import shutil

def storage_limit(services, owner, *, default_bytes=None):
    used = sum(int(item.get("retainedBytes", item.get("sizeBytes", 0))) for kind in ("FIGURE", "DATASET", "FIGURE_TEMPLATE") for item in services.list_owner_items(owner, kind))
    return used + shutil.disk_usage(services.data_dir).free
