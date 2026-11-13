"""Fixed, versioned, stdlib-only filesystem protocol (also executed over OpenSSH)."""
from __future__ import annotations
import base64
import difflib
import codecs
import hashlib
import heapq
import json
import os
import re
import stat
import sys
from contextlib import contextmanager

VERSION = 1
CHUNK = 1024 * 1024
MAX_EDIT = 2 * CHUNK


class FileProtocolError(ValueError):
    def __init__(self, code, message):
        super().__init__(message); self.code = code


def fail(code, message): raise FileProtocolError(code, message)


def identity(info):
    values = [info.st_dev, info.st_ino, info.st_mode, info.st_size, info.st_mtime_ns, info.st_ctime_ns]
    return hashlib.sha256(json.dumps(values).encode()).hexdigest()


def root_identity(info): return f'{info.st_dev}:{info.st_ino}'


def parts(path):
    if not isinstance(path, str) or len(path.encode()) > 4096 or path.startswith('/') or '\\' in path or '\x00' in path or any(p in {'.', '..', ''} for p in path.split('/')) and path:
        fail('FILE_PATH_INVALID', 'Choose a relative path inside the connected folder.')
    return path.split('/') if path else []


@contextmanager
def directory(root_fd, segments):
    descriptors = []
    try:
        current = root_fd
        for segment in segments:
            current = os.open(segment, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=current)
            descriptors.append(current)
        yield current
    finally:
        for fd in reversed(descriptors): os.close(fd)


@contextmanager
def regular(parent, name):
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode): fail('FILE_SPECIAL', 'Only regular files can be opened or transferred.')
        yield fd
    finally: os.close(fd)


def checksum(fd):
    os.lseek(fd, 0, os.SEEK_SET); digest = hashlib.sha256()
    while data := os.read(fd, CHUNK): digest.update(data)
    return digest.hexdigest()


def entry(parent, name):
    info = os.stat(name, dir_fd=parent, follow_symlinks=False)
    kind = 'symlink' if stat.S_ISLNK(info.st_mode) else 'directory' if stat.S_ISDIR(info.st_mode) else 'file' if stat.S_ISREG(info.st_mode) else 'special'
    return {'name': name, 'kind': kind, 'sizeBytes': info.st_size, 'identity': identity(info), 'modifiedNs': info.st_mtime_ns}


def encoded_text(data):
    try:
        text = data.decode('utf-8')
    except UnicodeError: fail('FILE_NOT_UTF8', 'This is not a UTF-8 text file. Transfer the original bytes instead.')
    if '\x00' in text: fail('FILE_BINARY', 'Binary files can be transferred but cannot be edited as text.')
    return text


def preserve_format(original, edited):
    before = encoded_text(original); bom = before.startswith('\ufeff')
    before = before.removeprefix('\ufeff'); edited = edited.removeprefix('\ufeff')
    lines = before.splitlines(keepends=True)
    values, endings = [], []
    for line in lines:
        ending = '\r\n' if line.endswith('\r\n') else '\n' if line.endswith('\n') else '\r' if line.endswith('\r') else ''
        values.append(line[:-len(ending)] if ending else line); endings.append(ending)
    new = edited.replace('\r\n', '\n').replace('\r', '\n').splitlines(keepends=True)
    new_values = [line[:-1] if line.endswith('\n') else line for line in new]
    default = max((e for e in ['\r\n', '\n', '\r']), key=endings.count) if any(endings) else '\n'
    output_endings = [default if line.endswith('\n') else '' for line in new]
    for block in difflib.SequenceMatcher(None, values, new_values, autojunk=True).get_matching_blocks():
        for offset in range(block.size):
            # A newly inserted final line keeps its explicit trailing-newline choice.
            if output_endings[block.b + offset]: output_endings[block.b + offset] = endings[block.a + offset] or default
    return (('\ufeff' if bom else '') + ''.join(value + ending for value, ending in zip(new_values, output_endings))).encode('utf-8')


def perform(request):
    if sys.version_info < (3, 10): fail('FILE_PYTHON_VERSION', 'Connected folders require Python 3.10 or later on this source.')
    if request.get('version') != VERSION: fail('FILE_PROTOCOL_VERSION', 'Reconnect with a matching Phynite file helper.')
    root = request.get('root')
    if not isinstance(root, str) or not root.startswith('/') or '..' in root.split('/') or '\x00' in root: fail('FILE_ROOT_INVALID', 'Choose an absolute folder path without traversal.')
    if not all(hasattr(os, name) for name in ['O_DIRECTORY', 'O_NOFOLLOW']): fail('FILE_PLATFORM_UNQUALIFIED', 'Use Phynite inside WSL2 or a supported POSIX host for connected folders.')
    if request.get('operation') == 'probe': root = os.path.realpath(root, strict=True)
    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        root_info = os.fstat(fd)
        if request.get('operation') == 'probe': return {'version': VERSION, 'root': root, 'rootIdentity': root_identity(root_info), 'python': list(sys.version_info[:3])}
        if request.get('rootIdentity') != root_identity(root_info): fail('FILE_ROOT_CHANGED', 'The connected folder identity changed. Reconnect it before continuing.')
        path = request.get('path', ''); segments = parts(path); operation = request.get('operation')
        if operation == 'list':
            with directory(fd, segments) as parent:
                revision = identity(os.fstat(parent)); cursor = request.get('cursor')
                after = ''
                if cursor:
                    try: prior = json.loads(base64.b64decode(cursor, validate=True)); after = prior['after']
                    except (ValueError, KeyError, TypeError): fail('FILE_CURSOR_INVALID', 'Refresh this folder listing.')
                    if prior.get('revision') != revision: fail('FILE_DIRECTORY_CHANGED', 'The directory changed. Refresh its listing.')
                query = str(request.get('filter', ''))[:200].casefold()
                with os.scandir(parent) as stream:
                    names = heapq.nsmallest(201, (e.name for e in stream if query in e.name.casefold() and e.name > after))
                entries = []
                for name in names[:200]:
                    try: entries.append(entry(parent, name))
                    except FileNotFoundError: fail('FILE_DIRECTORY_CHANGED', 'The directory changed. Refresh its listing.')
                if revision != identity(os.fstat(parent)): fail('FILE_DIRECTORY_CHANGED', 'The directory changed. Refresh its listing.')
                return {'entries': entries, 'sourceRevision': revision, 'cursor': base64.b64encode(json.dumps({'revision': revision, 'after': names[199]}).encode()).decode() if len(names) > 200 else None}
        if not segments: fail('FILE_PATH_INVALID', 'Choose a file inside this folder.')
        with directory(fd, segments[:-1]) as parent:
            name = segments[-1]
            if operation in {'read', 'edit', 'hash', 'chunk'}:
                with regular(parent, name) as source:
                    info = os.fstat(source); revision = identity(info)
                    if request.get('identity') and request['identity'] != revision: fail('FILE_CHANGED', 'This file changed. Refresh it before continuing.')
                    if operation == 'hash':
                        if info.st_size > 1024 ** 3: fail('FILE_TRANSFER_LIMIT', 'Select files of at most 1 GiB per batch.')
                        sha = checksum(source); result = {'sha256': sha}
                    elif operation == 'chunk':
                        offset = request.get('offset', 0)
                        if type(offset) is not int or not 0 <= offset <= info.st_size: fail('FILE_RANGE', 'Choose a valid byte range.')
                        os.lseek(source, offset, os.SEEK_SET); data = os.read(source, CHUNK)
                        result = {'bytes': base64.b64encode(data).decode(), 'chunkSha256': hashlib.sha256(data).hexdigest(), 'offset': offset}
                    else:
                        limit = MAX_EDIT if operation == 'edit' else request.get('limit', 64 * 1024)
                        if type(limit) is not int or limit < 1 or limit > (MAX_EDIT if operation == 'edit' else 256 * 1024): fail('FILE_LIMIT', 'Preview is limited to 256 KiB; the UTF-8 editor is limited to 2 MiB.')
                        if operation == 'edit' and info.st_size > MAX_EDIT: fail('FILE_EDITOR_LIMIT', 'This file exceeds the 2 MiB editor limit. Transfer it instead.')
                        data = b''
                        while len(data) < min(limit, info.st_size):
                            piece = os.read(source, min(CHUNK, limit - len(data)))
                            if not piece: break
                            data += piece
                        if operation == 'read' and len(data) < info.st_size:
                            try:
                                decoder = codecs.getincrementaldecoder('utf-8')(); text = decoder.decode(data, final=False)
                                pending, _ = decoder.getstate(); data = data[:-len(pending)] if pending else data
                            except UnicodeError: fail('FILE_NOT_UTF8', 'This file is not UTF-8 text. Transfer the original bytes instead.')
                        else: text = encoded_text(data)
                        result = {'text': text, 'truncated': len(data) < info.st_size, 'windowSha256': hashlib.sha256(data).hexdigest()}
                        if operation == 'edit': result['sha256'] = result['windowSha256']
                    if revision != identity(os.fstat(source)): fail('FILE_CHANGED', 'This file changed while it was read. Refresh it.')
                    return {**result, 'identity': revision, 'sizeBytes': info.st_size}
            if operation == 'write':
                if request.get('writeAllowed') is not True: fail('FILE_READ_ONLY', 'Grant this connected folder write access before saving a copy or replacing a file.')
                mode = request.get('mode')
                if mode not in {'copy', 'replace'}: fail('FILE_WRITE_MODE', 'Choose Save edited copy or explicitly review Replace original.')
                data = base64.b64decode(request.get('bytes', ''), validate=True)
                if len(data) > MAX_EDIT: fail('FILE_EDITOR_LIMIT', 'Edited text exceeds 2 MiB.')
                encoded_text(data)
                target = request.get('target')
                if not isinstance(target, str) or len(parts(target)) != 1 or mode == 'copy' and target == name: fail('FILE_WRITE_MODE', 'Choose a new filename for the edited copy.')
                with regular(parent, name) as source:
                    original_info = os.fstat(source); revision = identity(original_info); sha = checksum(source)
                    if request.get('identity') != revision or request.get('sha256') != sha or revision != identity(os.fstat(source)): fail('FILE_CHANGED', 'The original changed. Review its latest version or save your draft separately.')
                    if identity(os.stat(name, dir_fd=parent, follow_symlinks=False)) != revision: fail('FILE_CHANGED', 'The original identity changed. Refresh it before saving.')
                if mode == 'copy':
                    destination = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent)
                    try:
                        with os.fdopen(destination, 'wb') as stream: stream.write(data); stream.flush(); os.fsync(stream.fileno())
                    except BaseException:
                        # A partial copy is retained and never reported as complete.
                        raise
                else:
                    if request.get('replaceQualified') is not True or request.get('reviewedSha256') != hashlib.sha256(data).hexdigest(): fail('FILE_REPLACE_UNQUALIFIED', 'Replacement requires a qualified filesystem and an explicit reviewed diff.')
                    if target != name: fail('FILE_WRITE_MODE', 'Replace original must target the reviewed original.')
                    if not re.fullmatch(r'[a-f0-9]{32}', str(request.get('operationId'))): fail('FILE_OPERATION_INVALID', 'Invalid file operation identity.')
                    temporary = '.phynite-edit-' + request['operationId']
                    destination = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, stat.S_IMODE(original_info.st_mode) & 0o777, dir_fd=parent)
                    with os.fdopen(destination, 'wb') as stream: stream.write(data); stream.flush(); os.fsync(stream.fileno())
                    # Best-effort conflict fencing; an external editor can still race this final rename.
                    if identity(os.stat(name, dir_fd=parent, follow_symlinks=False)) != revision: fail('FILE_CHANGED', 'The original changed after review. The prepared copy was retained.')
                    os.replace(temporary, name, src_dir_fd=parent, dst_dir_fd=parent)
                os.fsync(parent)
                with regular(parent, target) as saved:
                    if checksum(saved) != hashlib.sha256(data).hexdigest(): fail('FILE_CHECKSUM', 'Saved checksum verification failed. Inspect the retained copy before retrying.')
                return {'entry': entry(parent, target), 'sha256': hashlib.sha256(data).hexdigest()}
        fail('FILE_OPERATION_INVALID', 'This file operation is not supported.')
    finally: os.close(fd)


if __name__ == '__main__':
    try:
        raw = sys.stdin.buffer.read(4 * CHUNK + 1)
        if len(raw) > 4 * CHUNK: fail('FILE_LIMIT', 'The file request exceeds its bounded protocol limit.')
        result = perform(json.loads(raw))
        print(json.dumps({'version': VERSION, 'result': result}, ensure_ascii=True))
    except Exception as error:
        print(json.dumps({'version': VERSION, 'error': str(error)[:2000], 'code': getattr(error, 'code', 'FILE_SOURCE_FAILED')}, ensure_ascii=True))
        sys.exit(1)
