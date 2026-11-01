#!/usr/bin/env bash
set -ex

make CC=$CC \
     OBJCOPY=$OBJCOPY \
     prefix=$PREFIX \
     CFLAGS="${CFLAGS}" \
     LDFLAGS="${LDFLAGS}" \
     lib=lib
make prefix=$PREFIX \
     lib=lib \
     SBINDIR=$PREFIX/sbin \
     PAM_LIBDIR=$PREFIX/lib \
     RAISE_SETFCAP=no \
     install
