# PrivAudit: Automated Privacy Audits and Code Annotation During Development

## Description

This project is part of a MS in Computer Science thesis with the aim of creating a Visual Studio Code extension that leverages Copilot to conduct privacy audits in real-time during code development. The principle componets of the extension are:

1. Leverages Copilot LLMs to analze code and report back data privacy relevant artifacts, risks, and usage.
2. Uses two schemas to tailor Copilot requests & responses:
    - A schema that enumerates a set of **privacy processes** that show the LLM what it should be flagging. We call this the Privacy Detection Schema (PDS).
    - A schema that standardizes and formats the output of the LLM. Essentially, a template that the LLM should use to relay information back to the user. We call this the Privacy Relay Schema (PRS).
3. Performs in-code highlighting and annotations of the returned privacy information.
4. Stores the audits in a central knowledge base or manifest. 

## Progress

Currently the following has been completed:

- Used the VS Code extension generator to scaffold the project.
- Registered a simple Chat Participant called PrivAudit
- Defined a slash command called `audit` that takes a code selection or whole file (using `vscode.window.activeTextEditor`) and packages it along with a simple base prompt to send to Copilot. 
- Prompts are created using the Prompt TSX library.
- Responses are currenly just returned in the chat window. 