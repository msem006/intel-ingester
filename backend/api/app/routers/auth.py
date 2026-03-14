from fastapi import APIRouter, Response, HTTPException
from pydantic import BaseModel
from ..auth import check_password, create_session_cookie, clear_session_cookie

router = APIRouter(prefix='/auth', tags=['auth'])


class LoginRequest(BaseModel):
    password: str


@router.post('/login')
def login(body: LoginRequest, response: Response):
    if not check_password(body.password):
        raise HTTPException(status_code=401, detail="Invalid password")
    create_session_cookie(response)
    return {'status': 'ok'}


@router.post('/logout')
def logout(response: Response):
    clear_session_cookie(response)
    return {'status': 'ok'}
