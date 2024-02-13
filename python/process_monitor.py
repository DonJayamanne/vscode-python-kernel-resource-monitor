import sys
import datetime
import json
import threading
import time
import psutil

from typing import List

pids: List[int] = []
lock = threading.Lock()

def read_input():
    while True:
        try:
            # Read input from stdin
            line = sys.stdin.readline().strip()

            # Parse the input as JSON
            data = json.loads(line)
            pid = int(data.get("pid", 0))
            if pid == 0:
                continue
            
            with lock:
                if pid > 0:
                    if pid not in pids:
                        pids.append(pid)
                else:
                    pid = pid * -1
                    if pid in pids:
                        pids.remove(pid)
        except KeyboardInterrupt:
            # Exit gracefully on keyboard interrupt
            break
        except Exception as e:
            # Handle any other exceptions
            print(f"Error: {e}", file=sys.stderr)

def get_process_metric_value(process, name, attribute=None):
    """Get the process metric value."""
    try:
        metric_value = getattr(process, name)()
        if attribute is not None:  # ... a named tuple
            return getattr(metric_value, attribute)
        # ... or a number
        return metric_value
    # Avoid littering logs with stack traces
    # complaining about dead processes
    except BaseException:
        return None

all_processes_of_pid = {}
process_by_pid = {}

def clear_cache():
    all_processes_of_pid.clear()
    process_by_pid.clear()

def process_input(pid: int):
    try:
        # Cache process list and process objects
        current_process = process_by_pid.get(pid, None)
        if current_process is None:
            current_process = psutil.Process(pid)
        process_by_pid[pid] = current_process

        all_processes = all_processes_of_pid.get(pid, None)
        if all_processes is None:
            all_processes = [current_process, *current_process.children(recursive=True)]
        all_processes_of_pid[pid] = all_processes

        reply_content = {}
        reply_content["pid"] = pid
        reply_content["kernel_cpu"] = sum(
            [
                get_process_metric_value(process, "cpu_percent", None)
                for process in all_processes
            ]
        )
        reply_content["kernel_memory"] = sum(
            [
                # get_process_metric_value(process, "memory_full_info", "uss") 
                get_process_metric_value(process, "memory_info", "rss")
                for process in all_processes
            ]
        )
        json.dump(reply_content, sys.stdout)
        print("852d303a-98f4-4384-a1a3-ebdace595f8c")
        sys.stdout.flush()
    except Exception as e:
        print(f"Error processing pid {pid}: {e}", file=sys.stderr)



# Define the function to send outputs at intervals of 1s
def send_outputs():
    current_datetime = datetime.datetime.now()
    while True:
        new_datetime = datetime.datetime.now()
        time_difference = (new_datetime - current_datetime).total_seconds()
        if time_difference >= 15:
            clear_cache()
            current_datetime = new_datetime

        with lock:
            copy_of_pids = pids.copy()

        for pid in copy_of_pids:
            process_input(pid)

        # Wait for 1 second
        time.sleep(1)


# Create a separate thread for sending outputs
output_thread = threading.Thread(target=send_outputs, daemon=True)
output_thread.start()
read_input()


