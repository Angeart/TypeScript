namespace ts.projectSystem {
    describe("tsserver:: Project Errors", () => {
        function checkProjectErrors(projectFiles: server.ProjectFilesWithTSDiagnostics, expectedErrors: ReadonlyArray<string>): void {
            assert.isTrue(projectFiles !== undefined, "missing project files");
            checkProjectErrorsWorker(projectFiles.projectErrors, expectedErrors);
        }

        function checkProjectErrorsWorker(errors: ReadonlyArray<Diagnostic>, expectedErrors: ReadonlyArray<string>): void {
            assert.equal(errors ? errors.length : 0, expectedErrors.length, `expected ${expectedErrors.length} error in the list`);
            if (expectedErrors.length) {
                for (let i = 0; i < errors.length; i++) {
                    const actualMessage = flattenDiagnosticMessageText(errors[i].messageText, "\n");
                    const expectedMessage = expectedErrors[i];
                    assert.isTrue(actualMessage.indexOf(expectedMessage) === 0, `error message does not match, expected ${actualMessage} to start with ${expectedMessage}`);
                }
            }
        }

        function checkDiagnosticsWithLinePos(errors: server.protocol.DiagnosticWithLinePosition[], expectedErrors: string[]) {
            assert.equal(errors ? errors.length : 0, expectedErrors.length, `expected ${expectedErrors.length} error in the list`);
            if (expectedErrors.length) {
                zipWith(errors, expectedErrors, ({ message: actualMessage }, expectedMessage) => {
                    assert.isTrue(startsWith(actualMessage, actualMessage), `error message does not match, expected ${actualMessage} to start with ${expectedMessage}`);
                });
            }
        }

        it("external project - diagnostics for missing files", () => {
            const file1 = {
                path: "/a/b/app.ts",
                content: ""
            };
            const file2 = {
                path: "/a/b/applib.ts",
                content: ""
            };
            const host = createServerHost([file1, libFile]);
            const session = createSession(host);
            const projectService = session.getProjectService();
            const projectFileName = "/a/b/test.csproj";
            const compilerOptionsRequest: server.protocol.CompilerOptionsDiagnosticsRequest = {
                type: "request",
                command: server.CommandNames.CompilerOptionsDiagnosticsFull,
                seq: 2,
                arguments: { projectFileName }
            };

            {
                projectService.openExternalProject({
                    projectFileName,
                    options: {},
                    rootFiles: toExternalFiles([file1.path, file2.path])
                });

                checkNumberOfProjects(projectService, { externalProjects: 1 });
                const diags = session.executeCommand(compilerOptionsRequest).response as server.protocol.DiagnosticWithLinePosition[];
                // only file1 exists - expect error
                checkDiagnosticsWithLinePos(diags, ["File '/a/b/applib.ts' not found."]);
            }
            host.reloadFS([file2, libFile]);
            {
                // only file2 exists - expect error
                checkNumberOfProjects(projectService, { externalProjects: 1 });
                const diags = session.executeCommand(compilerOptionsRequest).response as server.protocol.DiagnosticWithLinePosition[];
                checkDiagnosticsWithLinePos(diags, ["File '/a/b/app.ts' not found."]);
            }

            host.reloadFS([file1, file2, libFile]);
            {
                // both files exist - expect no errors
                checkNumberOfProjects(projectService, { externalProjects: 1 });
                const diags = session.executeCommand(compilerOptionsRequest).response as server.protocol.DiagnosticWithLinePosition[];
                checkDiagnosticsWithLinePos(diags, []);
            }
        });

        it("configured projects - diagnostics for missing files", () => {
            const file1 = {
                path: "/a/b/app.ts",
                content: ""
            };
            const file2 = {
                path: "/a/b/applib.ts",
                content: ""
            };
            const config = {
                path: "/a/b/tsconfig.json",
                content: JSON.stringify({ files: [file1, file2].map(f => getBaseFileName(f.path)) })
            };
            const host = createServerHost([file1, config, libFile]);
            const session = createSession(host);
            const projectService = session.getProjectService();
            openFilesForSession([file1], session);
            checkNumberOfProjects(projectService, { configuredProjects: 1 });
            const project = configuredProjectAt(projectService, 0);
            const compilerOptionsRequest: server.protocol.CompilerOptionsDiagnosticsRequest = {
                type: "request",
                command: server.CommandNames.CompilerOptionsDiagnosticsFull,
                seq: 2,
                arguments: { projectFileName: project.getProjectName() }
            };
            let diags = session.executeCommand(compilerOptionsRequest).response as server.protocol.DiagnosticWithLinePosition[];
            checkDiagnosticsWithLinePos(diags, ["File '/a/b/applib.ts' not found."]);

            host.reloadFS([file1, file2, config, libFile]);

            checkNumberOfProjects(projectService, { configuredProjects: 1 });
            diags = session.executeCommand(compilerOptionsRequest).response as server.protocol.DiagnosticWithLinePosition[];
            checkDiagnosticsWithLinePos(diags, []);
        });

        it("configured projects - diagnostics for corrupted config 1", () => {
            const file1 = {
                path: "/a/b/app.ts",
                content: ""
            };
            const file2 = {
                path: "/a/b/lib.ts",
                content: ""
            };
            const correctConfig = {
                path: "/a/b/tsconfig.json",
                content: JSON.stringify({ files: [file1, file2].map(f => getBaseFileName(f.path)) })
            };
            const corruptedConfig = {
                path: correctConfig.path,
                content: correctConfig.content.substr(1)
            };
            const host = createServerHost([file1, file2, corruptedConfig]);
            const projectService = createProjectService(host);

            projectService.openClientFile(file1.path);
            {
                projectService.checkNumberOfProjects({ configuredProjects: 1 });
                const configuredProject = find(projectService.synchronizeProjectList([]), f => f.info!.projectName === corruptedConfig.path)!;
                assert.isTrue(configuredProject !== undefined, "should find configured project");
                checkProjectErrors(configuredProject, []);
                const projectErrors = configuredProjectAt(projectService, 0).getAllProjectErrors();
                checkProjectErrorsWorker(projectErrors, [
                    "'{' expected."
                ]);
                assert.isNotNull(projectErrors[0].file);
                assert.equal(projectErrors[0].file!.fileName, corruptedConfig.path);
            }
            // fix config and trigger watcher
            host.reloadFS([file1, file2, correctConfig]);
            {
                projectService.checkNumberOfProjects({ configuredProjects: 1 });
                const configuredProject = find(projectService.synchronizeProjectList([]), f => f.info!.projectName === corruptedConfig.path)!;
                assert.isTrue(configuredProject !== undefined, "should find configured project");
                checkProjectErrors(configuredProject, []);
                const projectErrors = configuredProjectAt(projectService, 0).getAllProjectErrors();
                checkProjectErrorsWorker(projectErrors, []);
            }
        });

        it("configured projects - diagnostics for corrupted config 2", () => {
            const file1 = {
                path: "/a/b/app.ts",
                content: ""
            };
            const file2 = {
                path: "/a/b/lib.ts",
                content: ""
            };
            const correctConfig = {
                path: "/a/b/tsconfig.json",
                content: JSON.stringify({ files: [file1, file2].map(f => getBaseFileName(f.path)) })
            };
            const corruptedConfig = {
                path: correctConfig.path,
                content: correctConfig.content.substr(1)
            };
            const host = createServerHost([file1, file2, correctConfig]);
            const projectService = createProjectService(host);

            projectService.openClientFile(file1.path);
            {
                projectService.checkNumberOfProjects({ configuredProjects: 1 });
                const configuredProject = find(projectService.synchronizeProjectList([]), f => f.info!.projectName === corruptedConfig.path)!;
                assert.isTrue(configuredProject !== undefined, "should find configured project");
                checkProjectErrors(configuredProject, []);
                const projectErrors = configuredProjectAt(projectService, 0).getAllProjectErrors();
                checkProjectErrorsWorker(projectErrors, []);
            }
            // break config and trigger watcher
            host.reloadFS([file1, file2, corruptedConfig]);
            {
                projectService.checkNumberOfProjects({ configuredProjects: 1 });
                const configuredProject = find(projectService.synchronizeProjectList([]), f => f.info!.projectName === corruptedConfig.path)!;
                assert.isTrue(configuredProject !== undefined, "should find configured project");
                checkProjectErrors(configuredProject, []);
                const projectErrors = configuredProjectAt(projectService, 0).getAllProjectErrors();
                checkProjectErrorsWorker(projectErrors, [
                    "'{' expected."
                ]);
                assert.isNotNull(projectErrors[0].file);
                assert.equal(projectErrors[0].file!.fileName, corruptedConfig.path);
            }
        });
    });

    describe("tsserver:: Project Errors are reported as appropriate", () => {
        function createErrorLogger() {
            let hasError = false;
            const errorLogger: server.Logger = {
                close: noop,
                hasLevel: () => true,
                loggingEnabled: () => true,
                perftrc: noop,
                info: noop,
                msg: (_s, type) => {
                    if (type === server.Msg.Err) {
                        hasError = true;
                    }
                },
                startGroup: noop,
                endGroup: noop,
                getLogFileName: () => undefined
            };
            return {
                errorLogger,
                hasError: () => hasError
            };
        }

        it("document is not contained in project", () => {
            const file1 = {
                path: "/a/b/app.ts",
                content: ""
            };
            const corruptedConfig = {
                path: "/a/b/tsconfig.json",
                content: "{"
            };
            const host = createServerHost([file1, corruptedConfig]);
            const projectService = createProjectService(host);

            projectService.openClientFile(file1.path);
            projectService.checkNumberOfProjects({ configuredProjects: 1 });

            const project = projectService.findProject(corruptedConfig.path)!;
            checkProjectRootFiles(project, [file1.path]);
        });

        describe("when opening new file that doesnt exist on disk yet", () => {
            function verifyNonExistentFile(useProjectRoot: boolean) {
                const folderPath = "/user/someuser/projects/someFolder";
                const fileInRoot: File = {
                    path: `/src/somefile.d.ts`,
                    content: "class c { }"
                };
                const fileInProjectRoot: File = {
                    path: `${folderPath}/src/somefile.d.ts`,
                    content: "class c { }"
                };
                const host = createServerHost([libFile, fileInRoot, fileInProjectRoot]);
                const { hasError, errorLogger } = createErrorLogger();
                const session = createSession(host, { canUseEvents: true, logger: errorLogger, useInferredProjectPerProjectRoot: true });

                const projectService = session.getProjectService();
                const untitledFile = "untitled:Untitled-1";
                const refPathNotFound1 = "../../../../../../typings/@epic/Core.d.ts";
                const refPathNotFound2 = "./src/somefile.d.ts";
                const fileContent = `/// <reference path="${refPathNotFound1}" />
/// <reference path="${refPathNotFound2}" />`;
                session.executeCommandSeq<protocol.OpenRequest>({
                    command: server.CommandNames.Open,
                    arguments: {
                        file: untitledFile,
                        fileContent,
                        scriptKindName: "TS",
                        projectRootPath: useProjectRoot ? folderPath : undefined
                    }
                });
                checkNumberOfProjects(projectService, { inferredProjects: 1 });
                const infoForUntitledAtProjectRoot = projectService.getScriptInfoForPath(`${folderPath.toLowerCase()}/${untitledFile.toLowerCase()}` as Path);
                const infoForUnitiledAtRoot = projectService.getScriptInfoForPath(`/${untitledFile.toLowerCase()}` as Path);
                const infoForSomefileAtProjectRoot = projectService.getScriptInfoForPath(`/${folderPath.toLowerCase()}/src/somefile.d.ts` as Path);
                const infoForSomefileAtRoot = projectService.getScriptInfoForPath(`${fileInRoot.path.toLowerCase()}` as Path);
                if (useProjectRoot) {
                    assert.isDefined(infoForUntitledAtProjectRoot);
                    assert.isUndefined(infoForUnitiledAtRoot);
                }
                else {
                    assert.isDefined(infoForUnitiledAtRoot);
                    assert.isUndefined(infoForUntitledAtProjectRoot);
                }
                assert.isUndefined(infoForSomefileAtRoot);
                assert.isUndefined(infoForSomefileAtProjectRoot);

                // Since this is not js project so no typings are queued
                host.checkTimeoutQueueLength(0);

                const newTimeoutId = host.getNextTimeoutId();
                const expectedSequenceId = session.getNextSeq();
                session.executeCommandSeq<protocol.GeterrRequest>({
                    command: server.CommandNames.Geterr,
                    arguments: {
                        delay: 0,
                        files: [untitledFile]
                    }
                });
                host.checkTimeoutQueueLength(1);

                // Run the last one = get error request
                host.runQueuedTimeoutCallbacks(newTimeoutId);

                assert.isFalse(hasError());
                host.checkTimeoutQueueLength(0);
                checkErrorMessage(session, "syntaxDiag", { file: untitledFile, diagnostics: [] });
                session.clearMessages();

                host.runQueuedImmediateCallbacks();
                assert.isFalse(hasError());
                const errorOffset = fileContent.indexOf(refPathNotFound1) + 1;
                checkErrorMessage(session, "semanticDiag", {
                    file: untitledFile,
                    diagnostics: [
                        createDiagnostic({ line: 1, offset: errorOffset }, { line: 1, offset: errorOffset + refPathNotFound1.length }, Diagnostics.File_0_not_found, [refPathNotFound1], "error"),
                        createDiagnostic({ line: 2, offset: errorOffset }, { line: 2, offset: errorOffset + refPathNotFound2.length }, Diagnostics.File_0_not_found, [refPathNotFound2.substr(2)], "error")
                    ]
                });
                session.clearMessages();

                host.runQueuedImmediateCallbacks(1);
                assert.isFalse(hasError());
                checkErrorMessage(session, "suggestionDiag", { file: untitledFile, diagnostics: [] });
                checkCompleteEvent(session, 2, expectedSequenceId);
                session.clearMessages();
            }

            it("has projectRoot", () => {
                verifyNonExistentFile(/*useProjectRoot*/ true);
            });

            it("does not have projectRoot", () => {
                verifyNonExistentFile(/*useProjectRoot*/ false);
            });
        });

        it("folder rename updates project structure and reports no errors", () => {
            const projectDir = "/a/b/projects/myproject";
            const app: File = {
                path: `${projectDir}/bar/app.ts`,
                content: "class Bar implements foo.Foo { getFoo() { return ''; } get2() { return 1; } }"
            };
            const foo: File = {
                path: `${projectDir}/foo/foo.ts`,
                content: "declare namespace foo { interface Foo { get2(): number; getFoo(): string; } }"
            };
            const configFile: File = {
                path: `${projectDir}/tsconfig.json`,
                content: JSON.stringify({ compilerOptions: { module: "none", targer: "es5" }, exclude: ["node_modules"] })
            };
            const host = createServerHost([app, foo, configFile]);
            const session = createSession(host, { canUseEvents: true, });
            const projectService = session.getProjectService();

            session.executeCommandSeq<protocol.OpenRequest>({
                command: server.CommandNames.Open,
                arguments: { file: app.path, }
            });
            checkNumberOfProjects(projectService, { configuredProjects: 1 });
            assert.isDefined(projectService.configuredProjects.get(configFile.path));
            verifyErrorsInApp();

            host.renameFolder(`${projectDir}/foo`, `${projectDir}/foo2`);
            host.runQueuedTimeoutCallbacks();
            host.runQueuedTimeoutCallbacks();
            verifyErrorsInApp();

            function verifyErrorsInApp() {
                session.clearMessages();
                const expectedSequenceId = session.getNextSeq();
                session.executeCommandSeq<protocol.GeterrRequest>({
                    command: server.CommandNames.Geterr,
                    arguments: {
                        delay: 0,
                        files: [app.path]
                    }
                });
                host.checkTimeoutQueueLengthAndRun(1);
                checkErrorMessage(session, "syntaxDiag", { file: app.path, diagnostics: [] });
                session.clearMessages();

                host.runQueuedImmediateCallbacks();
                checkErrorMessage(session, "semanticDiag", { file: app.path, diagnostics: [] });
                session.clearMessages();

                host.runQueuedImmediateCallbacks(1);
                checkErrorMessage(session, "suggestionDiag", { file: app.path, diagnostics: [] });
                checkCompleteEvent(session, 2, expectedSequenceId);
                session.clearMessages();
            }
        });

        it("Getting errors before opening file", () => {
            const file: File = {
                path: "/a/b/project/file.ts",
                content: "let x: number = false;"
            };
            const host = createServerHost([file, libFile]);
            const { hasError, errorLogger } = createErrorLogger();
            const session = createSession(host, { canUseEvents: true, logger: errorLogger });

            session.clearMessages();
            const expectedSequenceId = session.getNextSeq();
            session.executeCommandSeq<protocol.GeterrRequest>({
                command: server.CommandNames.Geterr,
                arguments: {
                    delay: 0,
                    files: [file.path]
                }
            });

            host.runQueuedImmediateCallbacks();
            assert.isFalse(hasError());
            checkCompleteEvent(session, 1, expectedSequenceId);
            session.clearMessages();
        });

        it("Reports errors correctly when file referenced by inferred project root, is opened right after closing the root file", () => {
            const projectRoot = "/user/username/projects/myproject";
            const app: File = {
                path: `${projectRoot}/src/client/app.js`,
                content: ""
            };
            const serverUtilities: File = {
                path: `${projectRoot}/src/server/utilities.js`,
                content: `function getHostName() { return "hello"; } export { getHostName };`
            };
            const backendTest: File = {
                path: `${projectRoot}/test/backend/index.js`,
                content: `import { getHostName } from '../../src/server/utilities';export default getHostName;`
            };
            const files = [libFile, app, serverUtilities, backendTest];
            const host = createServerHost(files);
            const session = createSession(host, { useInferredProjectPerProjectRoot: true, canUseEvents: true });
            openFilesForSession([{ file: app, projectRootPath: projectRoot }], session);
            const service = session.getProjectService();
            checkNumberOfProjects(service, { inferredProjects: 1 });
            const project = service.inferredProjects[0];
            checkProjectActualFiles(project, [libFile.path, app.path]);
            openFilesForSession([{ file: backendTest, projectRootPath: projectRoot }], session);
            checkNumberOfProjects(service, { inferredProjects: 1 });
            checkProjectActualFiles(project, files.map(f => f.path));
            checkErrors([backendTest.path, app.path]);
            closeFilesForSession([backendTest], session);
            openFilesForSession([{ file: serverUtilities.path, projectRootPath: projectRoot }], session);
            checkErrors([serverUtilities.path, app.path]);

            function checkErrors(openFiles: [string, string]) {
                const expectedSequenceId = session.getNextSeq();
                session.executeCommandSeq<protocol.GeterrRequest>({
                    command: protocol.CommandTypes.Geterr,
                    arguments: {
                        delay: 0,
                        files: openFiles
                    }
                });

                for (const openFile of openFiles) {
                    session.clearMessages();
                    host.checkTimeoutQueueLength(3);
                    host.runQueuedTimeoutCallbacks(host.getNextTimeoutId() - 1);

                    checkErrorMessage(session, "syntaxDiag", { file: openFile, diagnostics: [] });
                    session.clearMessages();

                    host.runQueuedImmediateCallbacks();
                    checkErrorMessage(session, "semanticDiag", { file: openFile, diagnostics: [] });
                    session.clearMessages();

                    host.runQueuedImmediateCallbacks(1);
                    checkErrorMessage(session, "suggestionDiag", { file: openFile, diagnostics: [] });
                }
                checkCompleteEvent(session, 2, expectedSequenceId);
                session.clearMessages();
            }
        });
    });

    describe("tsserver:: Project Errors dont include overwrite emit error", () => {
        it("for inferred project", () => {
            const f1 = {
                path: "/a/b/f1.js",
                content: "function test1() { }"
            };
            const host = createServerHost([f1, libFile]);
            const session = createSession(host);
            openFilesForSession([f1], session);

            const projectService = session.getProjectService();
            checkNumberOfProjects(projectService, { inferredProjects: 1 });
            const projectName = projectService.inferredProjects[0].getProjectName();

            const diags = session.executeCommand(<server.protocol.CompilerOptionsDiagnosticsRequest>{
                type: "request",
                command: server.CommandNames.CompilerOptionsDiagnosticsFull,
                seq: 2,
                arguments: { projectFileName: projectName }
            }).response as ReadonlyArray<protocol.DiagnosticWithLinePosition>;
            assert.isTrue(diags.length === 0);

            session.executeCommand(<server.protocol.SetCompilerOptionsForInferredProjectsRequest>{
                type: "request",
                command: server.CommandNames.CompilerOptionsForInferredProjects,
                seq: 3,
                arguments: { options: { module: ModuleKind.CommonJS } }
            });
            const diagsAfterUpdate = session.executeCommand(<server.protocol.CompilerOptionsDiagnosticsRequest>{
                type: "request",
                command: server.CommandNames.CompilerOptionsDiagnosticsFull,
                seq: 4,
                arguments: { projectFileName: projectName }
            }).response as ReadonlyArray<protocol.DiagnosticWithLinePosition>;
            assert.isTrue(diagsAfterUpdate.length === 0);
        });

        it("for external project", () => {
            const f1 = {
                path: "/a/b/f1.js",
                content: "function test1() { }"
            };
            const host = createServerHost([f1, libFile]);
            const session = createSession(host);
            const projectService = session.getProjectService();
            const projectFileName = "/a/b/project.csproj";
            const externalFiles = toExternalFiles([f1.path]);
            projectService.openExternalProject(<protocol.ExternalProject>{
                projectFileName,
                rootFiles: externalFiles,
                options: {}
            });

            checkNumberOfProjects(projectService, { externalProjects: 1 });

            const diags = session.executeCommand(<server.protocol.CompilerOptionsDiagnosticsRequest>{
                type: "request",
                command: server.CommandNames.CompilerOptionsDiagnosticsFull,
                seq: 2,
                arguments: { projectFileName }
            }).response as ReadonlyArray<server.protocol.DiagnosticWithLinePosition>;
            assert.isTrue(diags.length === 0);

            session.executeCommand(<server.protocol.OpenExternalProjectRequest>{
                type: "request",
                command: server.CommandNames.OpenExternalProject,
                seq: 3,
                arguments: {
                    projectFileName,
                    rootFiles: externalFiles,
                    options: { module: ModuleKind.CommonJS }
                }
            });
            const diagsAfterUpdate = session.executeCommand(<server.protocol.CompilerOptionsDiagnosticsRequest>{
                type: "request",
                command: server.CommandNames.CompilerOptionsDiagnosticsFull,
                seq: 4,
                arguments: { projectFileName }
            }).response as ReadonlyArray<server.protocol.DiagnosticWithLinePosition>;
            assert.isTrue(diagsAfterUpdate.length === 0);
        });
    });
}
