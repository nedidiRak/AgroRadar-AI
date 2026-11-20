"""Negotiate gzip for reads of the dashboard, forecasts and built frontend."""
import re

from starlette.datastructures import Headers
from starlette.middleware.gzip import GZipMiddleware
from starlette.types import Receive, Scope, Send


_OFFER = re.compile(r"(gzip|identity|\*)(?:\s*;\s*q\s*=\s*(0(?:\.\d{0,3})?|1(?:\.0{0,3})?))?", re.I)


class ReadGZipMiddleware(GZipMiddleware):
    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (scope["type"] != "http" or scope["method"] != "GET"
                or scope["path"].startswith(("/api/auth/", "/api/admin/"))):
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        # Starlette checks for a literal "gzip" substring. Respect explicit
        # refusals, weighted alternatives and repeated Accept-Encoding fields.
        weights = {}
        for entry in ",".join(headers.getlist("accept-encoding")).split(","):
            if match := _OFFER.fullmatch(entry.strip()):
                weights[match[1].lower()] = float(match[2] or 1)
        gzip = weights.get("gzip", weights.get("*", 0))
        use_gzip = gzip > 0 and gzip >= weights.get("identity", 0)
        if use_gzip != ("gzip" in headers.get("accept-encoding", "")):
            normalized = headers.mutablecopy()
            normalized["accept-encoding"] = "gzip" if use_gzip else "identity"
            scope = {**scope, "headers": normalized.raw}
        await super().__call__(scope, receive, send)
