"""Run real root-scoped filesystem checks without opening a user project."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.local_api.desktop_server import DesktopApplication


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True, type=Path, help='Explicit existing folder for private scratch files.')
    parser.add_argument('--output', required=True, type=Path)
    options = parser.parse_args()
    root = options.root.resolve(strict=True)
    with tempfile.TemporaryDirectory(prefix='phynite-files-qualification-core-') as temporary:
        app = DesktopApplication(Path(temporary), 0, 'http://127.0.0.1:3000')
        try:
            reply = app.dispatch('POST', '/v1/projects', json.dumps({'name': 'Filesystem qualification'}).encode(), {'Authorization': 'Bearer ' + app.token}, {})
            project = json.loads(reply['body'])['project']['id']
            files = app.connected_files
            connected = files.connect(project, {'requestId': 'qualification', 'name': 'Explicit qualification root', 'source': 'local', 'path': str(root)})
            connected = files.capability(project, connected['id'], {'capabilityRevision': connected['capabilityRevision'], 'write': True})
            qualified = files.qualify(project, connected, {'capabilityRevision': connected['capabilityRevision']})
            proof = qualified['replacementQualification']
            report = {'schemaVersion': 1, 'kind': 'actual-filesystem', 'root': str(root), 'replaceQualified': qualified['replaceQualified'], **{key: value for key, value in proof.items() if key not in {'session'}}}
            options.output.parent.mkdir(parents=True, exist_ok=True)
            options.output.write_text(json.dumps(report, indent=2) + '\n')
            print(json.dumps({'passed': report['passed'], 'platform': report['platform'], 'checks': len(report['checks']), 'output': str(options.output)}))
        finally:
            app.close()


if __name__ == '__main__':
    main()
