#!/usr/bin/env python3
"""Emulate a Linux CFS CPU quota (cgroup cpu.max) on macOS for one process tree root.

usage: cfs_throttle.py <pid> <quota_ms> [period_ms=100]

Every period the process may use <quota_ms> of CPU time (user+system, all threads);
once it has, it is SIGSTOPped until the period ends, then SIGCONTed. This is how
Render's fractional-CPU instances (0.1 CPU = 10 ms per 100 ms) throttle a container.
CPU time comes from proc_pid_rusage (Mach absolute time units, converted).
Prints the throttled fraction of periods on exit (SIGTERM).
"""
import ctypes, os, signal, sys, time

pid, quota_ms = int(sys.argv[1]), float(sys.argv[2])
period_ms = float(sys.argv[3]) if len(sys.argv) > 3 else 100.0

libc = ctypes.CDLL('/usr/lib/libSystem.B.dylib')

class TB(ctypes.Structure):
    _fields_ = [('numer', ctypes.c_uint32), ('denom', ctypes.c_uint32)]
tb = TB(); libc.mach_timebase_info(ctypes.byref(tb))
TICK_NS = tb.numer / tb.denom

class RUsageV2(ctypes.Structure):
    _fields_ = [('uuid', ctypes.c_uint8 * 16), ('user', ctypes.c_uint64), ('system', ctypes.c_uint64)] + \
               [(f'f{i}', ctypes.c_uint64) for i in range(30)]

ru = RUsageV2()
def cpu_ms():
    if libc.proc_pid_rusage(pid, 2, ctypes.byref(ru)) != 0:
        raise ProcessLookupError
    return (ru.user + ru.system) * TICK_NS / 1e6

stopped = False
periods = throttled = 0
def finish(*_):
    try: os.kill(pid, signal.SIGCONT)
    except ProcessLookupError: pass
    print(f'cfs_throttle: periods={periods} throttled={throttled} ({100*throttled/max(1,periods):.1f}%)', flush=True)
    sys.exit(0)
signal.signal(signal.SIGTERM, finish)
signal.signal(signal.SIGINT, finish)

try:
    while True:
        start = time.monotonic(); base = cpu_ms(); periods += 1; hit = False
        end = start + period_ms / 1000
        while True:
            now = time.monotonic()
            if now >= end: break
            if not hit and cpu_ms() - base >= quota_ms:
                os.kill(pid, signal.SIGSTOP); hit = True; throttled += 1
                time.sleep(max(0, end - time.monotonic()))
                break
            time.sleep(0.0005)
        if hit: os.kill(pid, signal.SIGCONT)
except ProcessLookupError:
    finish()
