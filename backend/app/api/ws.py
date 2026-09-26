"""WebSocket stream of live pipeline progress."""
from __future__ import annotations

import asyncio
import contextlib
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.progress import hub

log = logging.getLogger(__name__)
router = APIRouter(prefix="/ws", tags=["ws"])

TERMINAL = {"complete", "failed"}


@router.websocket("/pipeline/{contract_id}")
async def pipeline_stream(websocket: WebSocket, contract_id: str) -> None:
    await websocket.accept()
    hub.bind_loop(asyncio.get_running_loop())
    queue, replay = hub.subscribe(contract_id)
    try:
        for event in replay:
            await websocket.send_json(event)
            if event.get("stage") in TERMINAL:
                await websocket.close()
                return
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=30.0)
            except TimeoutError:
                await websocket.send_json({"contract_id": contract_id,
                                           "stage": "heartbeat",
                                           "message": "", "pct": 0.0, "payload": {}})
                continue
            await websocket.send_json(event)
            if event.get("stage") in TERMINAL:
                break
    except WebSocketDisconnect:
        pass
    except Exception:
        log.exception("websocket error for contract %s", contract_id)
    finally:
        hub.unsubscribe(contract_id, queue)
        with contextlib.suppress(RuntimeError):
            await websocket.close()
