package main

import "unsafe"

func uintptrPointer(p *uint16) uintptr { return uintptr(unsafe.Pointer(p)) }
