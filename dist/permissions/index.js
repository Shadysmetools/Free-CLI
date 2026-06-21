"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPreview = exports.defaultConfirm = exports.DEFAULT_DENY = exports.persistAllowPattern = exports.matchesAny = exports.matchPattern = exports.defaultRules = exports.loadPermissionRules = exports.isInside = exports.subjectsFor = exports.classify = exports.gate = void 0;
var gate_1 = require("./gate");
Object.defineProperty(exports, "gate", { enumerable: true, get: function () { return gate_1.gate; } });
var classify_1 = require("./classify");
Object.defineProperty(exports, "classify", { enumerable: true, get: function () { return classify_1.classify; } });
Object.defineProperty(exports, "subjectsFor", { enumerable: true, get: function () { return classify_1.subjectsFor; } });
Object.defineProperty(exports, "isInside", { enumerable: true, get: function () { return classify_1.isInside; } });
var rules_1 = require("./rules");
Object.defineProperty(exports, "loadPermissionRules", { enumerable: true, get: function () { return rules_1.loadPermissionRules; } });
Object.defineProperty(exports, "defaultRules", { enumerable: true, get: function () { return rules_1.defaultRules; } });
Object.defineProperty(exports, "matchPattern", { enumerable: true, get: function () { return rules_1.matchPattern; } });
Object.defineProperty(exports, "matchesAny", { enumerable: true, get: function () { return rules_1.matchesAny; } });
Object.defineProperty(exports, "persistAllowPattern", { enumerable: true, get: function () { return rules_1.persistAllowPattern; } });
Object.defineProperty(exports, "DEFAULT_DENY", { enumerable: true, get: function () { return rules_1.DEFAULT_DENY; } });
var prompt_1 = require("./prompt");
Object.defineProperty(exports, "defaultConfirm", { enumerable: true, get: function () { return prompt_1.defaultConfirm; } });
Object.defineProperty(exports, "buildPreview", { enumerable: true, get: function () { return prompt_1.buildPreview; } });
__exportStar(require("./types"), exports);
//# sourceMappingURL=index.js.map