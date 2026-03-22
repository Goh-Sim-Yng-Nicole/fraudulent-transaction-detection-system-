# ruff: noqa: I001
import uvicorn

if __name__ == "__main__":
    uvicorn.run("services.detect_fraud.app:app", host="0.0.0.0", port=8008)
