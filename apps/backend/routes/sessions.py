import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import knot

router = APIRouter()


class SessionCreateResponse(BaseModel):
    session_id: str
    external_user_id: str


@router.post("/sessions", response_model=SessionCreateResponse)
async def create_session() -> SessionCreateResponse:
    external_user_id = f"twinstore-{uuid.uuid4().hex[:16]}"
    try:
        session_id = await knot.create_session(external_user_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"knot session/create failed: {e}")
    return SessionCreateResponse(
        session_id=session_id, external_user_id=external_user_id
    )
