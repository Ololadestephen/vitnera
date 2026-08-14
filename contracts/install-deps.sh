#!/bin/sh
set -eu

CONTRACTS_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)

if [ ! -f "$CONTRACTS_DIR/lib/forge-std/src/Test.sol" ]; then
  forge install --root "$CONTRACTS_DIR" foundry-rs/forge-std@v1.9.6 --no-git
fi

if [ ! -f "$CONTRACTS_DIR/lib/openzeppelin-contracts/contracts/access/Ownable2Step.sol" ]; then
  forge install --root "$CONTRACTS_DIR" OpenZeppelin/openzeppelin-contracts@v5.2.0 --no-git
fi
