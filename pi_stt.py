#!/usr/bin/env python3
"""
MIRROR Bot — Offline Vosk STT WebSocket Server
Uses arecord (native ALSA/PipeWire tool) instead of PortAudio.
Works on Pi OS Bookworm with PipeWire audio system.

Requirements: pip3 install vosk websockets --break-system-packages
              sudo apt install -y alsa-utils
Model: vosk-model directory in same folder as this script

Usage: python3 pi_stt.py
"""

import asyncio
import websockets
import json
import sys
import os
import subprocess

try:
    import vosk
except ImportError:
    print("Missing vosk. Run: pip3 install vosk --break-system-packages")
    sys.exit(1)

# ─── Config ──────────────────────────────────────────────────────────
MODEL_PATH  = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vosk-model")
SAMPLE_RATE = 16000
CHUNK_BYTES = 8192   # 4096 samples × 2 bytes (int16)
HOST        = "localhost"
PORT        = 8765
# ─────────────────────────────────────────────────────────────────────

def load_model():
    if not os.path.exists(MODEL_PATH):
        print(f"\n❌ Vosk model not found at: {MODEL_PATH}")
        print("Download:")
        print("  wget https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip")
        print("  unzip vosk-model-small-en-us-0.15.zip && mv vosk-model-small-en-us-0.15 vosk-model")
        sys.exit(1)
    print("   Loading Vosk model...")
    vosk.SetLogLevel(-1)
    return vosk.Model(MODEL_PATH)


def find_input_device():
    import subprocess
    import re
    try:
        out = subprocess.check_output(["arecord", "-l"], stderr=subprocess.DEVNULL).decode()
        for line in out.split("\n"):
            if "card" in line.lower() and "device" in line.lower():
                card_match = re.search(r"card\s+(\d+)", line, re.IGNORECASE)
                dev_match = re.search(r"device\s+(\d+)", line, re.IGNORECASE)
                if card_match:
                    card_num = card_match.group(1)
                    dev_num = dev_match.group(1) if dev_match else "0"
                    device_name = f"plughw:{card_num},{dev_num}"
                    print(f"[STT] Auto-detected input device: {device_name}")
                    return device_name
    except Exception as e:
        print(f"[STT] Error auto-detecting input device: {e}")
    return "default"


async def stt_handler(websocket, model):
    """Handle one browser connection — opens mic via arecord, streams recognition."""
    print(f"\n[STT] Browser connected")

    rec = vosk.KaldiRecognizer(model, SAMPLE_RATE)
    device = find_input_device()

    # Use arecord — native ALSA tool, works with PipeWire on Pi OS Bookworm
    arecord_cmd = [
        "arecord",
        "-D", device,
        "-f", "S16_LE",       # 16-bit signed little-endian
        "-r", str(SAMPLE_RATE),# 16000 Hz sample rate
        "-c", "1",             # mono
        "-t", "raw",           # raw PCM output (no WAV header)
        "-q",                  # quiet (suppress messages)
        "-"                    # output to stdout
    ]

    print(f"[STT] 🎙️  Opening microphone ({device}) via arecord...")

    try:
        proc = await asyncio.create_subprocess_exec(
            *arecord_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )

        print("[STT] 🎙️  Microphone open! Streaming to browser...")
        await websocket.send(json.dumps({"type": "ready", "engine": "vosk"}))

        while True:
            data = await proc.stdout.read(CHUNK_BYTES)
            if not data:
                break

            if rec.AcceptWaveform(data):
                result = json.loads(rec.Result())
                text   = result.get("text", "").strip()
                if text:
                    print(f"[STT] ✓ {text}")
                    await websocket.send(json.dumps({
                        "type" : "transcript",
                        "text" : text,
                        "final": True
                    }))
            else:
                partial = json.loads(rec.PartialResult())
                text    = partial.get("partial", "").strip()
                if text:
                    await websocket.send(json.dumps({
                        "type" : "transcript",
                        "text" : text,
                        "final": False
                    }))

    except websockets.exceptions.ConnectionClosed:
        print("[STT] Browser disconnected.")
    except Exception as e:
        print(f"[STT] Error: {e}")
    finally:
        try:
            # Check for any arecord error messages
            err_data = await proc.stderr.read()
            if err_data:
                print(f"[STT] arecord error: {err_data.decode().strip()}")
            proc.terminate()
            await proc.wait()
        except Exception:
            pass
        print("[STT] Mic closed.")


async def main():
    print("=" * 50)
    print("  MIRROR Bot — Vosk Offline STT Server")
    print("=" * 50)

    model = load_model()
    print("   ✅ Model loaded!\n")

    async with websockets.serve(
        lambda ws: stt_handler(ws, model),
        HOST, PORT,
        ping_interval=20,
        ping_timeout=10
    ):
        print(f"[STT] ✅ WebSocket server on ws://{HOST}:{PORT}")
        print("[STT]    Waiting for browser...\n")
        await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[STT] Server stopped.")
