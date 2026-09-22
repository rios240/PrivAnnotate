/**
 * Mocha `--require` hook for the plain-Node unit run: intercepts
 * `require('vscode')` and serves the stub in `./vscodeStub`.
 *
 * Not loaded by the Extension Development Host run (`npm test`), where the real
 * `vscode` module is injected by the host itself.
 */
import Module = require('module');
import * as vscodeStub from './vscodeStub';

type Loader = (request: string, parent: unknown, isMain: boolean) => unknown;

const moduleWithLoad = Module as unknown as { _load: Loader };
const originalLoad = moduleWithLoad._load;

moduleWithLoad._load = function (request, parent, isMain) {
    if (request === 'vscode') {return vscodeStub;}
    return originalLoad.call(this, request, parent, isMain);
};