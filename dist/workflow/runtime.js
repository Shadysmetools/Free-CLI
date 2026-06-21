"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setWorkflowRuntime = setWorkflowRuntime;
exports.getWorkflowRuntime = getWorkflowRuntime;
exports.clearWorkflowRuntime = clearWorkflowRuntime;
let current = null;
function setWorkflowRuntime(ctx) { current = ctx; }
function getWorkflowRuntime() { return current; }
function clearWorkflowRuntime() { current = null; }
//# sourceMappingURL=runtime.js.map