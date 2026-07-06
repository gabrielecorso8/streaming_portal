# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_submodules, collect_data_files

hidden = []
for pkg in ["uvicorn", "fastapi", "starlette", "anyio", "m3u8",
            "bs4", "lxml", "cryptography", "requests", "socks", "qrcode"]:
    try:
        hidden += collect_submodules(pkg)
    except Exception:
        pass

datas = [("static", "static")]

a = Analysis(
    ["launcher_exe.py"],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hidden,
    hookspath=[],
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="SC Portal",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    icon="static/favicon.ico",
)
