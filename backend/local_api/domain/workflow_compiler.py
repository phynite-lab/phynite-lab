"""Bounded execution of the same scientific input compiler shipped to the browser.

Only trusted bundled code runs. Input crosses as JSON, without host callables,
filesystem, network, process APIs or dynamically supplied JavaScript.
"""
from __future__ import annotations
import hashlib
import json
from functools import lru_cache
from pathlib import Path
from typing import Any
from backend.local_api.domain.phynite_core import ApiError, json_safe


@lru_cache(maxsize=1)
def compiler_source() -> str:
    path = Path(__file__).with_name('workflow_compiler_bundle.js')
    source = path.read_text()
    manifest = json.loads(path.with_suffix('.js.json').read_text())
    if hashlib.sha256(source.encode()).hexdigest() != manifest['sha256']:
        raise ApiError(503, 'Scientific compiler integrity check failed.', 'WORKFLOW_COMPILER_UNAVAILABLE')
    return source


def invoke(method: str, payload: list[Any], frozen: dict[str, str] | None = None) -> Any:
    if method not in {'compileBoundDft', 'validateDraft', 'compileMd', 'prepareNodes'}:
        raise ApiError(400, 'Unknown scientific compiler operation.', 'INVALID_WORKFLOW')
    try:
        import quickjs
        context = quickjs.Context()
        context.set_memory_limit(96 * 1024**2)
        context.set_max_stack_size(1024**2)
        context.set_time_limit(3)
        context.eval('globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));')
        source = compiler_source() if frozen is None else frozen["source"]
        if frozen is not None and hashlib.sha256(source.encode()).hexdigest() != frozen["sha256"]:
            raise ApiError(409, 'Run compiler snapshot checksum failed.', 'WORKFLOW_CORRUPT')
        context.eval(source)
        context.set('workflowArgumentsJson', json.dumps(json_safe(payload), allow_nan=False))
        context.set('workflowCompilerMethod', method)
        result = context.eval('JSON.stringify(PhyniteWorkflowCompiler[workflowCompilerMethod](...JSON.parse(workflowArgumentsJson)))')
        return json.loads(result)
    except ImportError as exc:
        raise ApiError(503, 'Update the control-plane scientific compiler before running this workflow.', 'WORKFLOW_COMPILER_UNAVAILABLE') from exc
    except ApiError:
        raise
    except Exception as exc:
        raise ApiError(422, f'Scientific input compilation failed: {str(exc).splitlines()[0][:300]}', 'WORKFLOW_CONFIGURATION_INVALID') from exc
