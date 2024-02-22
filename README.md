# Resource monitor for Python (Notebook) Kernels

This extension provides the ability for users to view the CPU and Memory usage of the Python kernel in real-time.

You can toggle displaying of CPU and Memory usage by clicking on the icons at the top of the view.

![](/resources/demo.png)

### Notes
* Only works with local Python (Notebook) Kernels.
* The CPU and Memory usages are approximations and may not be 100% accurate.
For instance the Memory usage displayed, is the `Real Memory` of the process instead of the `Private Memory`.
* Extra process is spawned to monitor the CPU and Memory usage of the Python kernel.
   The CPU and Memory usage of this extra process is negligible.
   These extra processes will be terminated when the kernel is shutdown, VS Code is shutdown/restarted or when the View is no longer displayed.

### Thanks
* Code for generating graphs have been borrowed from [Flame Chart Visualizer for JavaScript Profile](https://marketplace.visualstudio.com/items?itemName=ms-vscode.vscode-js-profile-flame).
