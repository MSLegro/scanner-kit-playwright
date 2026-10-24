#!/usr/bin/env bash
# scanner-kit-playwright - Setup para Linux / macOS
# Ejecuta todo el flujo de instalacion, compilacion y enlace global en un solo paso.
set -e

if ! command -v node >/dev/null 2>&1; then
    echo "Error: Node.js no está instalado o no se encuentra en el PATH."
    echo "Instálalo desde https://nodejs.org antes de continuar."
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "$SCRIPT_DIR/scripts/setup.js"
