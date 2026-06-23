#!/usr/bin/env python3
"""
Lightweight speech generator using Microsoft Edge TTS.
Saves natural speech audio to an MP3 file.
Usage: python3 pi_tts.py <text> <output_file>
"""
import asyncio
import sys
import os

try:
    import edge_tts
except ImportError:
    print("Error: edge-tts is not installed. Run: pip3 install edge-tts --break-system-packages")
    sys.exit(1)

async def main():
    if len(sys.argv) < 3:
        print("Usage: python3 pi_tts.py <text> <output_file>")
        sys.exit(1)

    text = sys.argv[1]
    output_file = sys.argv[2]
    
    # Using Microsoft's premium en-US Aria voice
    voice = "en-US-AriaNeural"

    # Make sure output directory exists
    os.makedirs(os.path.dirname(os.path.abspath(output_file)), exist_ok=True)

    try:
        communicate = edge_tts.Communicate(text, voice)
        await communicate.save(output_file)
        print(f"Speech saved successfully to {output_file}")
    except Exception as e:
        print(f"Error generating speech: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())
