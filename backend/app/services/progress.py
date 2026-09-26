"""In-process pub/sub for live pipeline progress.

The pipeline is synchronous and CPU-bound, so it runs in a worker thread while
FastAPI stays responsive. Progress therefore crosses a thread boundary into the
event loop, which is what `call_soon_threadsafe` is for here.

Each contract keeps a short replay buffer so a client that connects a moment
after analysis starts still sees the stages it missed instead of an empty
screen.
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import threading
from collections import defaultdict, deque
from typing import Any

log = logging.getLogger(__name__)

REPLAY = 40


class ProgressHub:
    def __init__(self) -> None:
        self._subs: dict[str, list[asyncio.Queue]] = defaultdict(list)
        self._history: dict[str, deque] = defaultdict(lambda: deque(maxlen=REPLAY))
        self._loop: asyncio.AbstractEventLoop | None = None
        self._lock = threading.Lock()

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    # ---------------------------------------------------------- publishing
    def publish(self, contract_id: str, event: dict[str, Any]) -> None:
        """Safe to call from any thread."""
        with self._lock:
            self._history[contract_id].append(event)
            queues = list(self._subs.get(contract_id, ()))
        if not queues:
            return
        loop = self._loop
        for q in queues:
            if loop and loop.is_running():
                with contextlib.suppress(RuntimeError):
                    loop.call_soon_threadsafe(q.put_nowait, event)
            else:
                with contextlib.suppress(asyncio.QueueFull):
                    q.put_nowait(event)

    # -------------------------------------------------------- subscribing
    def subscribe(self, contract_id: str) -> tuple[asyncio.Queue, list[dict]]:
        q: asyncio.Queue = asyncio.Queue(maxsize=256)
        with self._lock:
            self._subs[contract_id].append(q)
            replay = list(self._history.get(contract_id, ()))
        return q, replay

    def unsubscribe(self, contract_id: str, q: asyncio.Queue) -> None:
        with self._lock:
            subs = self._subs.get(contract_id)
            if subs and q in subs:
                subs.remove(q)
            if subs is not None and not subs:
                self._subs.pop(contract_id, None)

    def history(self, contract_id: str) -> list[dict]:
        with self._lock:
            return list(self._history.get(contract_id, ()))

    def clear(self, contract_id: str) -> None:
        with self._lock:
            self._history.pop(contract_id, None)


hub = ProgressHub()
