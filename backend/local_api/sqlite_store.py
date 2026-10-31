"""Transactional local persistence for the application's DynamoDB-shaped records.

This is a storage adapter, not a network emulator. Only the expression grammar
used by the control plane is supported; unknown syntax fails closed.
"""
from __future__ import annotations

import base64
import copy
import json
import re
import sqlite3
import threading
from contextlib import contextmanager, closing
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Iterator
from botocore.exceptions import ClientError

MISSING = object()


class StorageError(ClientError):
    def __init__(self, code: str, message: str, reasons: list[dict] | None = None):
        payload: dict[str, Any] = {"Error": {"Code": code, "Message": message}}
        if reasons is not None:
            payload["CancellationReasons"] = reasons
        super().__init__(payload, "LocalPersistence")


class ConditionalCheckFailed(StorageError):
    pass


class TransactionCanceled(StorageError):
    pass


def pack(value: Any) -> str:
    def encode(item: Any):
        if isinstance(item, dict):
            return ['map', [[key, encode(value)] for key, value in item.items()]]
        if isinstance(item, list):
            return ['list', [encode(value) for value in item]]
        if isinstance(item, Decimal):
            return ['decimal', str(item)]
        if isinstance(item, (bytes, bytearray)):
            return ['bytes', base64.b64encode(item).decode()]
        if isinstance(item, set):
            return ['set', [encode(value) for value in item]]
        if item is None or isinstance(item, (str, int, float, bool)):
            return ['scalar', item]
        raise TypeError(f"Unsupported storage type: {type(item).__name__}")
    return json.dumps(['phynite-record-2', encode(value)], allow_nan=False, separators=(",", ":"))


def unpack(value: str) -> Any:
    raw = json.loads(value)
    if isinstance(raw, list) and len(raw) == 2 and raw[0] == 'phynite-record-2':
        def typed(item):
            kind, body = item
            if kind == 'map':
                return {key: typed(value) for key, value in body}
            if kind == 'list':
                return [typed(value) for value in body]
            if kind == 'decimal':
                return Decimal(body)
            if kind == 'bytes':
                return base64.b64decode(body)
            if kind == 'set':
                return {typed(value) for value in body}
            if kind == 'scalar':
                return body
            raise ValueError('Unsupported local record encoding')
        return typed(raw[1])
    def decode(item: dict):
        if set(item) == {"__phynite_decimal__"}:
            return Decimal(item["__phynite_decimal__"])
        if set(item) == {"__phynite_bytes__"}:
            return base64.b64decode(item["__phynite_bytes__"])
        if set(item) == {"__phynite_set__"}:
            return set(item["__phynite_set__"])
        return item
    return json.loads(value, object_hook=decode)


class Expression:
    TOKEN = re.compile(r"\s*(<=|>=|<>|[=<>(),+\-]|\#[\w]+|:[\w]+|[A-Za-z_][\w.]*|\d+)")

    def __init__(self, text: str, item: dict, names: dict | None = None, values: dict | None = None):
        self.item, self.names, self.values = item, names or {}, values or {}
        self.tokens: list[str] = []
        position = 0
        while position < len(text.rstrip()):
            match = self.TOKEN.match(text, position)
            if not match:
                raise ValueError(f"Unsupported persistence expression at {text[position:position + 30]!r}")
            self.tokens.append(match[1]); position = match.end()
        self.position = 0

    def peek(self, token: str) -> bool:
        return self.position < len(self.tokens) and self.tokens[self.position].upper() == token.upper()

    def take(self, expected: str | None = None) -> str:
        if self.position >= len(self.tokens):
            raise ValueError("Incomplete persistence expression")
        token = self.tokens[self.position]; self.position += 1
        if expected is not None and token.upper() != expected.upper():
            raise ValueError(f"Expected {expected}, received {token}")
        return token

    def path(self, token: str) -> list[str]:
        return [self.names.get(part, part) for part in token.split(".")]

    def atom(self) -> Any:
        token = self.take()
        if token.startswith(":"):
            return self.values[token]
        if token.isdecimal():
            return Decimal(token)
        if self.peek("("):
            self.take("("); args = [self.arithmetic()]
            while self.peek(","):
                self.take(","); args.append(self.arithmetic())
            self.take(")")
            functions = {
                "attribute_exists": lambda x: x is not MISSING,
                "attribute_not_exists": lambda x: x is MISSING,
                "begins_with": lambda x, y: x is not MISSING and isinstance(x, (str, bytes)) and x.startswith(y),
                "contains": lambda x, y: x is not MISSING and y in x,
                "if_not_exists": lambda x, y: y if x is MISSING else x,
                "list_append": lambda x, y: x + y,
                "size": lambda x: len(x) if x is not MISSING else MISSING,
            }
            if token not in functions:
                raise ValueError(f"Unsupported persistence function {token}")
            return functions[token](*args)
        value: Any = self.item
        for part in self.path(token):
            value = value.get(part, MISSING) if isinstance(value, dict) else MISSING
        return value

    def arithmetic(self) -> Any:
        value = self.atom()
        while self.peek("+") or self.peek("-"):
            operator = self.take(); right = self.atom()
            value = value + right if operator == "+" else value - right
        return value

    def comparison(self) -> bool:
        if self.peek("("):
            self.take(); value = self.disjunction(); self.take(")"); return value
        left = self.arithmetic()
        if self.peek("BETWEEN"):
            self.take(); low = self.arithmetic(); self.take("AND"); high = self.arithmetic()
            return left is not MISSING and low <= left <= high
        if self.peek("IN"):
            self.take(); self.take("("); values = [self.arithmetic()]
            while self.peek(","):
                self.take(); values.append(self.arithmetic())
            self.take(")"); return left is not MISSING and left in values
        if any(self.peek(op) for op in ("=", "<>", "<", ">", "<=", ">=")):
            op = self.take(); right = self.arithmetic()
            if left is MISSING or right is MISSING:
                return False
            return {"=": lambda: left == right, "<>": lambda: left != right,
                    "<": lambda: left < right, ">": lambda: left > right,
                    "<=": lambda: left <= right, ">=": lambda: left >= right}[op]()
        if not isinstance(left, bool):
            raise ValueError("A condition must evaluate to a boolean")
        return left

    def negation(self) -> bool:
        if self.peek("NOT"):
            self.take(); return not self.negation()
        return self.comparison()

    def conjunction(self) -> bool:
        result = self.negation()
        while self.peek("AND"):
            self.take(); other = self.negation(); result = result and other
        return result

    def disjunction(self) -> bool:
        result = self.conjunction()
        while self.peek("OR"):
            self.take(); other = self.conjunction(); result = result or other
        return result

    def condition(self) -> bool:
        result = self.disjunction()
        if self.position != len(self.tokens):
            raise ValueError("Unconsumed persistence expression")
        return result


def matches(text: str | None, item: dict, request: dict) -> bool:
    if not text:
        return True
    if not isinstance(text, str):
        text, names, values = condition_object(text)
        request = {**request, "ExpressionAttributeNames": names, "ExpressionAttributeValues": values}
    return Expression(text, item, request.get("ExpressionAttributeNames"), request.get("ExpressionAttributeValues")).condition()


def condition_object(condition: Any) -> tuple[str, dict, dict]:
    """Support boto3 Key/Attr objects without evaluating Python or SQL strings."""
    from boto3.dynamodb.conditions import ConditionExpressionBuilder
    result = ConditionExpressionBuilder().build_expression(condition)
    return result.condition_expression, result.attribute_name_placeholders, result.attribute_value_placeholders


class SQLiteTable:
    SCHEMA = 1

    def __init__(self, path: Path):
        self.path = Path(path).resolve(); self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.name = "phynite-local"
        self.lock = threading.RLock(); self.state = threading.local()
        with closing(self.connect()) as connection, connection:
            version = connection.execute("PRAGMA user_version").fetchone()[0]
            if version > self.SCHEMA:
                raise RuntimeError("This workspace needs a newer Phynite Lab. Its database was not changed.")
            if version == 0:
                existing = connection.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
                if existing:
                    with sqlite3.connect(str(self.path) + ".pre-migration.bak") as backup:
                        connection.backup(backup)
                connection.execute("CREATE TABLE IF NOT EXISTS records (pk TEXT NOT NULL, sk TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(pk,sk))")
                connection.execute(f"PRAGMA user_version={self.SCHEMA}")
        self.path.chmod(0o600)
        self.meta = SimpleNamespace(client=SQLiteClient(self, native=True))

    def connect(self):
        connection = sqlite3.connect(self.path, timeout=30)
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA synchronous=FULL")
        return connection

    @contextmanager
    def atomic(self) -> Iterator[sqlite3.Connection]:
        with self.lock:
            current = getattr(self.state, "connection", None)
            if current is not None:
                counter = getattr(self.state, 'savepoint_counter', 0) + 1
                self.state.savepoint_counter = counter
                point = f'local_nested_{counter}'
                current.execute(f'SAVEPOINT {point}')
                try:
                    yield current
                    current.execute(f'RELEASE SAVEPOINT {point}')
                except BaseException:
                    current.execute(f'ROLLBACK TO SAVEPOINT {point}')
                    current.execute(f'RELEASE SAVEPOINT {point}')
                    raise
                return
            connection = self.connect(); self.state.connection = connection
            try:
                connection.execute("BEGIN IMMEDIATE")
                yield connection
                connection.commit()
            except BaseException:
                connection.rollback(); raise
            finally:
                self.state.connection = None; connection.close()

    def _read(self, connection: sqlite3.Connection, key: dict) -> dict:
        row = connection.execute("SELECT value FROM records WHERE pk=? AND sk=?", (key["PK"], key["SK"])).fetchone()
        return unpack(row[0]) if row else {}

    def get_item(self, *, Key: dict, **_: Any) -> dict:
        with self.atomic() as connection:
            item = self._read(connection, Key)
            return {"Item": item} if item else {}

    def put_item(self, *, Item: dict, **request: Any) -> dict:
        with self.atomic() as connection:
            previous = self._read(connection, Item)
            self._check(previous, request)
            connection.execute("INSERT INTO records VALUES(?,?,?) ON CONFLICT(pk,sk) DO UPDATE SET value=excluded.value", (Item["PK"], Item["SK"], pack(Item)))
            return {"Attributes": previous} if request.get("ReturnValues") == "ALL_OLD" else {}

    def _check(self, item: dict, request: dict):
        if not matches(request.get("ConditionExpression"), item, request):
            raise ConditionalCheckFailed("ConditionalCheckFailedException", "The saved record changed. Reload before retrying.")

    @contextmanager
    def batch_writer(self, **_):
        with self.atomic():
            yield self

    def delete_item(self, *, Key: dict, **request: Any) -> dict:
        with self.atomic() as connection:
            previous = self._read(connection, Key); self._check(previous, request)
            connection.execute("DELETE FROM records WHERE pk=? AND sk=?", (Key["PK"], Key["SK"]))
            return {"Attributes": previous} if request.get("ReturnValues") == "ALL_OLD" else {}

    def update_item(self, *, Key: dict, UpdateExpression: str, **request: Any) -> dict:
        with self.atomic() as connection:
            previous = self._read(connection, Key); self._check(previous, request)
            item = copy.deepcopy(previous or Key)
            expression = Expression(UpdateExpression, previous, request.get("ExpressionAttributeNames"), request.get("ExpressionAttributeValues"))
            while expression.position < len(expression.tokens):
                action = expression.take().upper()
                if action not in {"SET", "REMOVE", "ADD", "DELETE"}:
                    raise ValueError(f"Unsupported update action {action}")
                while expression.position < len(expression.tokens):
                    path = expression.path(expression.take())
                    if len(path) != 1:
                        raise ValueError("Nested updates are not supported by the local persistence contract")
                    field = path[0]
                    if field in {"PK", "SK"}:
                        raise ValueError("Primary keys are immutable")
                    if action == "SET":
                        expression.take("="); value = expression.arithmetic()
                        if value is MISSING:
                            raise ValueError("Cannot assign a missing attribute")
                        item[field] = value
                    elif action == "REMOVE":
                        item.pop(field, None)
                    elif action == "ADD":
                        value = expression.arithmetic()
                        item[field] = (item.get(field, set()) | value) if isinstance(value, set) else item.get(field, 0) + value
                    else:
                        item[field] = item.get(field, set()) - expression.arithmetic()
                    if not expression.peek(","):
                        break
                    expression.take(",")
            self.put_item(Item=item)
            returns = request.get("ReturnValues", "NONE")
            return {"Attributes": item if returns in {"ALL_NEW", "UPDATED_NEW"} else previous} if returns != "NONE" else {}

    def query(self, **request: Any) -> dict:
        index = request.get("IndexName")
        pk, sk = {None: ("PK", "SK"), "ProjectIndex": ("GSI1PK", "GSI1SK"), "BatchIndex": ("GSI2PK", "GSI2SK")}.get(index, (None, None))
        if pk is None:
            raise ValueError("Unknown local record index")
        with self.atomic() as connection:
            items = [unpack(row[0]) for row in connection.execute("SELECT value FROM records ORDER BY pk,sk")]
        items = [item for item in items if pk in item and sk in item and matches(request.get("KeyConditionExpression"), item, request)]
        items.sort(key=lambda item: (item[pk], item[sk], item["PK"], item["SK"]), reverse=not request.get("ScanIndexForward", True))
        start = request.get("ExclusiveStartKey")
        if start:
            offset = next((i + 1 for i, item in enumerate(items) if item["PK"] == start["PK"] and item["SK"] == start["SK"]), len(items))
            items = items[offset:]
        limit = request.get("Limit", len(items))
        if not isinstance(limit, int) or limit < 0:
            raise ValueError("Invalid query limit")
        page = items[:limit]; result: dict = {"ScannedCount": len(page)}
        if len(items) > len(page) and page:
            result["LastEvaluatedKey"] = {key: page[-1][key] for key in {"PK", "SK", pk, sk}}
        page = [item for item in page if matches(request.get("FilterExpression"), item, request)]
        result["Count"] = len(page)
        if request.get("Select") != "COUNT":
            if request.get("ProjectionExpression"):
                fields = [request.get("ExpressionAttributeNames", {}).get(field.strip(), field.strip()) for field in request["ProjectionExpression"].split(",")]
                page = [{field: item[field] for field in fields if field in item} for item in page]
            result["Items"] = page
        return result


class SQLiteClient:
    def __init__(self, table: SQLiteTable, *, native: bool = False):
        self.table, self.native = table, native
        self.exceptions = SimpleNamespace(ConditionalCheckFailedException=ConditionalCheckFailed, TransactionCanceledException=TransactionCanceled)

    def batch_get_item(self, *, RequestItems: dict, **_: Any) -> dict:
        result = {}
        for name, request in RequestItems.items():
            if name != self.table.name:
                raise ValueError('Cannot read another workspace')
            result[name] = [item['Item'] for key in request['Keys'] if (item := self.table.get_item(Key=key)).get('Item')]
        return {'Responses': result, 'UnprocessedKeys': {}}

    def transact_write_items(self, *, TransactItems: list[dict], **_: Any) -> dict:
        from boto3.dynamodb.types import TypeDeserializer
        decoder = TypeDeserializer(); reasons = [{"Code": "None"} for _ in TransactItems]
        try:
            with self.table.atomic() as connection:
                for index, entry in enumerate(TransactItems):
                    operation, raw = next(iter(entry.items())); request = dict(raw)
                    if request.pop("TableName") != self.table.name:
                        raise ValueError("A transaction cannot address another workspace")
                    for field in ("Key", "Item", "ExpressionAttributeValues"):
                        if field in request and not self.native:
                            request[field] = {key: decoder.deserialize(value) for key, value in request[field].items()}
                    if operation == "ConditionCheck":
                        self.table._check(self.table._read(connection, request.pop("Key")), request)
                    elif operation in {"Put", "Update", "Delete"}:
                        getattr(self.table, {"Put": "put_item", "Update": "update_item", "Delete": "delete_item"}[operation])(**request)
                    else:
                        raise ValueError("Unsupported transaction operation")
        except StorageError as error:
            reasons[index] = {"Code": "ConditionalCheckFailed"}
            raise TransactionCanceled("TransactionCanceledException", "Transaction was rolled back", reasons) from error
        return {}
