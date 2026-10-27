"""Flujo HTTP real contra un contenedor Go conectado a una base test_* desechable.

No imprime contraseñas ni tokens. Crea el primer admin con /app/admin por stdin.
"""
import json
import os
import secrets
import subprocess
import urllib.error
import urllib.request
import uuid

container = os.environ.get("SMOKE_CONTAINER", "alejandria-backend-smoke")
base = os.environ.get("SMOKE_BASE_URL", "http://127.0.0.1:18080") + "/api/v1"
inspection = json.loads(subprocess.check_output(["docker", "inspect", container]))[0]
env = dict(value.split("=", 1) for value in inspection["Config"]["Env"])
if not env.get("APP_DATABASE_NAME", "").startswith("test_"):
    raise SystemExit("Smoke test requires a test_* disposable database")

password = secrets.token_urlsafe(24)
email = f"admin-{uuid.uuid4()}@synthetic.invalid"
admin = {"email": email, "display_name": "HTTP smoke admin", "password": password}
subprocess.run(["docker", "exec", "-i", container, "/app/admin"], input=json.dumps(admin).encode(), check=True)
# El comando de bootstrap debe negarse a crear otro administrador.
second = subprocess.run(["docker", "exec", "-i", container, "/app/admin"], input=json.dumps({**admin, "email": f"other-{email}"}).encode(), capture_output=True)
assert second.returncode != 0, "Second bootstrap was accepted"


def call(method, path, token=None, payload=None, expected=200):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = None if payload is None else json.dumps(payload).encode()
    request = urllib.request.Request(base + path, data=data, headers=headers, method=method)
    try:
        response = urllib.request.urlopen(request, timeout=30)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        result = json.load(response)
        assert response.code == expected, (method, path, response.code, result)
    print(f"{method} {path}: {expected}")
    return result


staff = call("POST", "/auth/login", payload={"email": email, "password": password})["access_token"]
readers = []
for _ in range(2):
    new_email = f"reader-{uuid.uuid4()}@synthetic.invalid"
    call("POST", "/auth/register", payload={"email": new_email, "display_name": "HTTP smoke reader", "password": password}, expected=201)
    readers.append(call("POST", "/auth/login", payload={"email": new_email, "password": password})["access_token"])
author = call("POST", "/authors", staff, {"name": "Smoke author"})["id"]
genre = call("POST", "/genres", staff, {"name": f"Smoke-{uuid.uuid4()}"})["id"]
call("PUT", "/users/me/preferences/genres", readers[0], {"genre_ids": [genre]})
preferences = call("GET", "/users/me/preferences/genres?limit=1", readers[0])
assert preferences["data"][0]["genre_id"] == genre
call("PUT", "/users/me/preferences/genres", readers[0], {"genre_ids": [genre, genre]}, 400)
call("PUT", "/users/me/preferences/genres", readers[0], {"genre_ids": [9223372036854775807]}, 400)
book = call("POST", "/books", staff, {"title": "HTTP circulation smoke", "authors": [{"author_id": author, "role": "author"}], "genre_ids": [genre]}, 201)["id"]
copy = call("POST", f"/books/{book}/copies", staff, {"inventory_code": str(uuid.uuid4())})["id"]
rating = call("PUT", f"/users/me/ratings/{book}", readers[0], {"rating": 3})
updated = call("PUT", f"/users/me/ratings/{book}", readers[0], {"rating": 5})
assert rating["created_at"] == updated["created_at"] and updated["rating"] == 5
assert call("GET", "/users/me/ratings", readers[1])["data"] == []
call("PUT", f"/users/me/ratings/{book}", readers[0], {"rating": 6}, 400)
call("POST", "/users/me/interactions", readers[0], {"book_id": book, "interaction_type": "view"}, 201)
call("POST", "/users/me/interactions", readers[0], {"book_id": book, "interaction_type": "loan"}, 400)
call("POST", "/users/me/interactions", readers[0], {"book_id": book, "interaction_type": "view", "user_id": 999}, 400)
request = call("POST", "/loan-requests", readers[0], {"book_id": book}, 201)["id"]
call("POST", "/loan-requests", readers[0], {"book_id": book}, 409)
loan = call("POST", f"/loan-requests/{request}/deliver", staff, {"copy_id": copy})["id"]
reservation = call("POST", "/reservations", readers[1], {"book_id": book}, 201)
assert reservation["status"] == "waiting"
call("POST", f"/loans/{loan}/return", readers[0], expected=403)
call("POST", f"/loans/{loan}/return", staff)
ready = next(row for row in call("GET", "/reservations", readers[1])["data"] if row["id"] == reservation["id"])
assert ready["assignment_origin"] == "manual" and ready["assigned_by"] == call("GET", "/auth/me", staff)["id"]
loan2 = call("POST", f"/reservations/{reservation['id']}/pickup", staff)["id"]
renewal = call("POST", f"/loans/{loan2}/renewals", readers[1])["id"]
call("POST", f"/renewals/{renewal}/decision", staff, {"approve": True})
call("POST", f"/loans/{loan2}/renewals", readers[1], expected=409)
call("POST", f"/loans/{loan2}/return", staff)
assert call("GET", f"/books/{book}/copies", readers[0])["available"] == 1
automatic = call("POST", "/reservations", readers[0], {"book_id": book}, 201)
assert automatic["assignment_origin"] == "system" and automatic["assigned_by"] is None
call("POST", f"/reservations/{automatic['id']}/cancel", readers[0])
assert len(call("GET", "/users/me/interactions", readers[0])["data"]) == 1, "Circulation duplicated interaction events"
call("DELETE", f"/users/me/ratings/{book}", readers[0])
call("DELETE", "/users/me/preferences/genres", readers[0])
print("Docker HTTP smoke passed: personalization, assignment audit and full circulation flow")
