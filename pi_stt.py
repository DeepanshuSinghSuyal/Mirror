#!/usr/bin/env python3
"""
MIRROR Bot — Offline Vosk STT WebSocket Server
Runs on Raspberry Pi 4. Streams speech recognition to the browser.
100% offline — no internet needed for STT.

Requirements: pip3 install vosk pyaudio websockets
Model: download vosk-model-small-en-us-0.15 into ./vosk-model/

Usage: python3 pi_stt.py
"""

import asyncio
import websockets
import json
import sys
import os

# Check dependencies
try:
    import vosk
    import pyaudio
except ImportError as e:
    print(f"Missing package: {e}")
    print("Run: pip3 install vosk pyaudio websockets")
    sys.exit(1)

# ─── Config ──────────────────────────────────────────────────────────
MODEL_PATH   = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vosk-model")
SAMPLE_RATE  = 16000
CHUNK_SIZE   = 4096
HOST         = "localhost"
PORT         = 8765
# ─────────────────────────────────────────────────────────────────────

def load_model():
    if not os.path.exists(MODEL_PATH):
        print("\n❌ Vosk model not found!")
        print(f"   Expected at: {MODEL_PATH}")
        print("\n   Download it:")
        print("   wget https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip")
        print("   unzip vosk-model-small-en-us-0.15.zip")
        print("   mv vosk-model-small-en-us-0.15 vosk-model")
        sys.exit(1)
    print("   Loading Vosk model (may take ~10s on Pi)...")
    vosk.SetLogLevel(-1)
    return vosk.Model(MODEL_PATH)


async def stt_handler(websocket, model):
    """Handle one browser connection — opens mic, streams recognition."""
    client = websocket.remote_address
    print(f"\n[STT] Browser connected from {client}")

    audio_q  = asyncio.Queue()
    loop     = asyncio.get_running_loop()
    rec      = vosk.KaldiRecognizer(model, SAMPLE_RATE)

    # Open PyAudio mic using callback so it's non-blocking
    pa = pyaudio.PyAudio()

    def mic_callback(in_data, frame_count, time_info, status):
        loop.call_soon_threadsafe(audio_q.put_nowait, in_data)
        return (None, pyaudio.paContinue)

    stream = pa.open(
        format=pyaudio.paInt16,
        channels=1,
        rate=SAMPLE_RATE,
        input=True,
        frames_per_buffer=CHUNK_SIZE,
        stream_callback=mic_callback,
    )
    stream.start_stream()
    print("[STT] 🎙️  Microphone open, streaming to browser...")

    try:
        # Tell browser STT is ready
        await websocket.send(json.dumps({"type": "ready", "engine": "vosk"}))

        while True:
            data = await audio_q.get()

            if rec.AcceptWaveform(data):
                # Final result
                result = json.loads(rec.Result())
                text   = result.get("text", "").strip()
                if text:
                    print(f"[STT] ✓ Final  : {text}")
                    await websocket.send(json.dumps({
                        "type"  : "transcript",
                        "text"  : text,
                        "final" : True
                    }))
            else:
                # Partial result (interim)
                partial = json.loads(rec.PartialResult())
                text    = partial.get("partial", "").strip()
                if text:
                    await websocket.send(json.dumps({
                        "type"  : "transcript",
                        "text"  : text,
                        "final" : False
                    }))

    except websockets.exceptions.ConnectionClosed:
        print(f"[STT] Browser disconnected.")
    except Exception as e:
        print(f"[STT] Error: {e}")
    finally:
        stream.stop_stream()
        stream.close()
        pa.terminate()
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
        print(f"[STT] ✅ WebSocket server running on ws://{HOST}:{PORT}")
        print("[STT]    Waiting for browser to connect...\n")
        await asyncio.Future()  # run forever


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[STT] Server stopped.")
