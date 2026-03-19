---
title: 5种Skill设计模式
description: 翻译自Google出品的 《5 Agent Skill design patterns every ADK developer should know》
date: 2026-03-19 00:00:00+0000
draft: false
---

# 5 Agent Skill design patterns every ADK developer should know

**每位 ADK 开发人员都应该了解的 5 种代理技能设计模式**

When it comes to 𝚂𝙺𝙸𝙻𝙻.𝚖𝚍, developers tend to fixate on the format—getting the YAML right, structuring directories, and following the spec. But with more than 30 agent tools (like Claude Code, Gemini CLI, and Cursor) standardizing on the same layout, the formatting problem is practically obsolete.

> 说到 𝚂𝙺𝙸𝙻𝙻.𝚖𝚍，开发者往往会过于关注格式——确保 YAML 代码正确、目录结构清晰、遵循规范。但由于已有超过 30 种代理工具（例如 Claude Code、Gemini CLI 和 Cursor）采用相同的布局，格式问题实际上已经过时了。

The challenge now is content design. The specification explains how to package a skill, but offers zero guidance on how to structure the logic inside it. For example, a skill that wraps FastAPI conventions operates completely differently from a four-step documentation pipeline, even though their 𝚂𝙺𝙸𝙻𝙻.𝚖𝚍 files look identical on the outside.

> 现在的挑战在于内容设计。规范解释了如何打包一项技能，但完全没有提供关于如何构建其内部逻辑的指导。例如，一个封装了 FastAPI 约定的技能与一个四步文档流程的技能，即使它们的 𝚂𝙺𝙸𝙻𝙻.𝚖𝚍 文件看起来完全相同，但它们的运行方式却截然不同。

By studying how skills are built across the ecosystem—from Anthropic’s repositories to Vercel and Google's internal guidelines— there are five recurring design patterns that can help developers build agents.

> 通过研究整个生态系统中技能的构建方式——从 Anthropic 的存储库到 Vercel 和 Google 的内部指南——可以发现五种反复出现的设计模式，这些模式可以帮助开发者构建代理。



This article covers each one with working ADK code:
本文将逐一介绍，并提供可运行的 ADK 代码：

- Tool Wrapper: Make your agent an instant expert on any library
  工具包装器：让您的代理人瞬间成为任何库的专家
- Generator: Produce structured documents from a reusable template
  生成器：根据可重用模板生成结构化文档
- Reviewer: Score code against a checklist by severity
  审核员：根据严重程度，对照检查清单对代码进行评分。
- Inversion: The agent interviews you before acting
  反转：经纪人在采取行动前会先面试你。
- Pipeline: Enforce a strict multi-step workflow with checkpoints
  流水线：通过检查点强制执行严格的多步骤工作流程

![HDoDgs6XAAYtw04](/Users/majiang/Downloads/HDoDgs6XAAYtw04.jpg)

## Pattern 1: The Tool Wrapper 模式 1：工具包装

A Tool Wrapper gives your agent on-demand context for a specific library. Instead of hardcoding API conventions into your system prompt, you package them into a skill. Your agent only loads this context when it actually works with that technology.
工具封装器可为您的智能体提供特定库的按需上下文。您无需将 API 约定硬编码到系统提示中，而是将其打包到一个技能中。您的智能体仅在实际使用该技术时才会加载此上下文。

![HDoDoIeXAAUmQoy](HDoDoIeXAAUmQoy.jpg)

It is the simplest pattern to implement. The 𝚂𝙺𝙸𝙻𝙻.𝚖𝚍 file listens for specific library keywords in the user's prompt, dynamically loads your internal documentation from the  𝚛𝚎𝚏𝚎𝚛𝚎𝚗𝚌𝚎𝚜/ directory, and applies those rules as absolute truth. This is the exact mechanism you use to distribute your team's internal coding guidelines or specific framework best practices directly into your developers' workflows.
这是最容易实现的模式。𝚂𝙺𝙸𝙻𝙻.𝚖𝚍 文件监听用户提示符中的特定库关键字，从 𝚛𝚎𝚏𝚎𝚛𝚎𝚗𝚌𝚎𝚜/ 目录动态加载内部文档，并将这些规则作为绝对真理应用。这正是您将团队内部编码规范或特定框架最佳实践直接融入开发人员工作流程的机制。

Here is an example of a Tool Wrapper that teaches an agent how to write FastAPI code. Notice how the instructions explicitly tell the agent to load the 𝚌𝚘𝚗𝚟𝚎𝚗𝚝𝚒𝚘𝚗𝚜.𝚖𝚍 file only when it starts reviewing or writing code:
以下是一个工具包装器的示例，它教会代理如何编写 FastAPI 代码。请注意，指令明确地告诉代理，只有在开始审查或编写代码时才加载 𝚌𝚘𝚗𝚟𝚎𝚗𝚝𝚒𝚘𝚗𝚜.𝚖𝚍 文件：

```text
# skills/api-expert/SKILL.md
---
name: api-expert
description: FastAPI development best practices and conventions. Use when building, reviewing, or debugging FastAPI applications, REST APIs, or Pydantic models.
metadata:
  pattern: tool-wrapper
  domain: fastapi
---

You are an expert in FastAPI development. Apply these conventions to the user's code or question.

## Core Conventions

Load 'references/conventions.md' for the complete list of FastAPI best practices.

## When Reviewing Code
1. Load the conventions reference
2. Check the user's code against each convention
3. For each violation, cite the specific rule and suggest the fix

## When Writing Code
1. Load the conventions reference
2. Follow every convention exactly
3. Add type annotations to all function signatures
4. Use Annotated style for dependency injection
```

## Pattern 2: The Generator 模式 2：生成器

While the Tool Wrapper applies knowledge, the Generator enforces consistent output. If you struggle with an agent generating different document structures on every run, the Generator solves this by orchestrating a fill-in-the-blank process.
工具包装器负责应用知识，而生成器则确保输出的一致性。如果您遇到代理每次运行生成不同文档结构的问题，生成器可以通过协调填空过程来解决这个问题。

![HDoEJdZbEAEdYMo](HDoEJdZbEAEdYMo.jpg)

It leverages two optional directories: 𝚊𝚜𝚜𝚎𝚝𝚜/ holds your output template, and 𝚛𝚎𝚏𝚎𝚛𝚎𝚗𝚌𝚎𝚜/ holds your style guide. The instructions act as a project manager. They tell the agent to load the template, read the style guide, ask the user for missing variables, and populate the document. This is practical for generating predictable API documentation, standardizing commit messages, or scaffolding project architectures.
它利用了两个可选目录：`𝚊𝚜𝚜𝚎𝚝𝚜/` 存放输出模板，`𝚛𝚎𝚏𝚎𝚛𝚎𝚗𝚌𝚎𝚜/` 存放样式指南。指令充当项目管理器的角色。它们指示代理加载模板、读取样式指南、询问用户缺失的变量并填充文档。这对于生成可预测的 API 文档、标准化提交消息或搭建项目架构非常实用。

In this technical report generator example, the skill file does not contain the actual layout or the grammar rules. It simply coordinates the retrieval of those assets and forces the agent to execute them step by step:
在这个技术报告生成器示例中，技能文件不包含实际的布局或语法规则。它只是协调这些资源的检索，并强制代理逐步执行它们：

```text
# skills/report-generator/SKILL.md
---
name: report-generator
description: Generates structured technical reports in Markdown. Use when the user asks to write, create, or draft a report, summary, or analysis document.
metadata:
  pattern: generator
  output-format: markdown
---

You are a technical report generator. Follow these steps exactly:

Step 1: Load 'references/style-guide.md' for tone and formatting rules.

Step 2: Load 'assets/report-template.md' for the required output structure.

Step 3: Ask the user for any missing information needed to fill the template:
- Topic or subject
- Key findings or data points
- Target audience (technical, executive, general)

Step 4: Fill the template following the style guide rules. Every section in the template must be present in the output.

Step 5: Return the completed report as a single Markdown document.
```

## Pattern 3: The Reviewer 模式三：审阅者

The Reviewer pattern separates what to check from how to check it. Rather than writing a long system prompt detailing every code smell, you store a modular rubric inside a 𝚛𝚎𝚏𝚎𝚛𝚎𝚗𝚌𝚎𝚜/𝚛𝚎𝚟𝚒𝚎𝚠-𝚌𝚑𝚎𝚌𝚔𝚕𝚒𝚜𝚝.𝚖𝚍 file.
Reviewer 模式将检查内容与检查方式分开。与其编写冗长的系统提示来详细说明每个代码异味，不如将模块化的评分标准存储在 𝚛𝚎𝚏𝚎𝚛𝚎𝚗𝚌𝚎𝚜/𝚛𝚎𝚟𝚒𝚎𝚠-𝚌𝚑𝚎𝚌𝚔𝚕𝚒𝚜𝚝.𝚖𝚍 文件中。

![HDoEa51XEAIKSnO](HDoEa51XEAIKSnO.jpg)

When a user submits code, the agent loads this checklist and methodically scores the submission, grouping its findings by severity. If you swap out a Python style checklist for an OWASP security checklist, you get a completely different, specialized audit using the exact same skill infrastructure. It is a highly effective way to automate PR reviews or catch vulnerabilities before a human looks at the code.
当用户提交代码时，代理会加载此检查清单，并系统地对提交的代码进行评分，根据严重程度对结果进行分组。如果将 Python 风格的检查清单替换为 OWASP 安全检查清单，您将获得完全不同的、更专业的审计，而这一切都基于相同的技术基础架构。这是一种高效的方法，可以自动执行 PR 审查，或在人工查看代码之前发现漏洞。

The following code reviewer skill demonstrates this separation. The instructions remain static, but the agent dynamically loads the specific review criteria from an external checklist and forces a structured, severity-based output:
以下代码审查员技能展示了这种分离。指令保持不变，但代理会从外部清单动态加载具体的审查标准，并强制生成结构化的、基于严重性的输出：

```text
# skills/code-reviewer/SKILL.md
---
name: code-reviewer
description: Reviews Python code for quality, style, and common bugs. Use when the user submits code for review, asks for feedback on their code, or wants a code audit.
metadata:
  pattern: reviewer
  severity-levels: error,warning,info
---

You are a Python code reviewer. Follow this review protocol exactly:

Step 1: Load 'references/review-checklist.md' for the complete review criteria.

Step 2: Read the user's code carefully. Understand its purpose before critiquing.

Step 3: Apply each rule from the checklist to the code. For every violation found:
- Note the line number (or approximate location)
- Classify severity: error (must fix), warning (should fix), info (consider)
- Explain WHY it's a problem, not just WHAT is wrong
- Suggest a specific fix with corrected code

Step 4: Produce a structured review with these sections:
- **Summary**: What the code does, overall quality assessment
- **Findings**: Grouped by severity (errors first, then warnings, then info)
- **Score**: Rate 1-10 with brief justification
- **Top 3 Recommendations**: The most impactful improvements
```

## Pattern 4: Inversion 模式 4：倒置

Agents inherently want to guess and generate immediately. The Inversion pattern flips this dynamic. Instead of the user driving the prompt and the agent executing, the agent acts as an interviewer.
智能体天生倾向于猜测并立即生成答案。反转模式颠覆了这种动态。用户不再提出问题，智能体也不再执行，而是由智能体扮演面试官的角色。

![HDoEo5XbEAUaaFG](HDoEo5XbEAUaaFG.jpg)

Inversion relies on explicit, non-negotiable gating instructions (like "DO NOT start building until all phases are complete") to force the agent to gather context first. It asks structured questions sequentially and waits for your answers before moving to the next phase. The agent refuses to synthesize a final output until it has a complete picture of your requirements and deployment constraints.
逆向工程依赖于明确且不可协商的门控指令（例如“所有阶段完成后方可开始构建”），强制智能体首先收集上下文信息。它会按顺序提出结构化问题，并在获得您的答案后才进入下一阶段。智能体只有在全面了解您的需求和部署限制后才会生成最终输出。

To see this in action, look at this project planner skill. The crucial element here is the strict phasing and the explicit gatekeeping prompt that stops the agent from synthesizing the final plan until all user answers are collected:
要了解具体操作，请查看此项目规划器技能。关键在于严格的阶段划分和明确的把关提示，这些提示会阻止代理在收集到所有用户答案之前生成最终计划：

```text
# skills/project-planner/SKILL.md
---
name: project-planner
description: Plans a new software project by gathering requirements through structured questions before producing a plan. Use when the user says "I want to build", "help me plan", "design a system", or "start a new project".
metadata:
  pattern: inversion
  interaction: multi-turn
---

You are conducting a structured requirements interview. DO NOT start building or designing until all phases are complete.

## Phase 1 — Problem Discovery (ask one question at a time, wait for each answer)

Ask these questions in order. Do not skip any.

- Q1: "What problem does this project solve for its users?"
- Q2: "Who are the primary users? What is their technical level?"
- Q3: "What is the expected scale? (users per day, data volume, request rate)"

## Phase 2 — Technical Constraints (only after Phase 1 is fully answered)

- Q4: "What deployment environment will you use?"
- Q5: "Do you have any technology stack requirements or preferences?"
- Q6: "What are the non-negotiable requirements? (latency, uptime, compliance, budget)"

## Phase 3 — Synthesis (only after all questions are answered)

1. Load 'assets/plan-template.md' for the output format
2. Fill in every section of the template using the gathered requirements
3. Present the completed plan to the user
4. Ask: "Does this plan accurately capture your requirements? What would you change?"
5. Iterate on feedback until the user confirms
```

## Pattern 5: The Pipeline 模式 5：管道

For complex tasks, you cannot afford skipped steps or ignored instructions. The Pipeline pattern enforces a strict, sequential workflow with hard checkpoints.
对于复杂任务，容不得跳过任何步骤或忽略任何指令。流水线模式强制执行严格的顺序工作流程，并设置了关键的检查点。

The instructions themselves serve as the workflow definition. By implementing explicit diamond gate conditions (such as requiring user approval before moving from docstring generation to final assembly), the Pipeline ensures an agent cannot bypass a complex task and present an unvalidated final result.
指令本身即构成工作流程定义。通过实施明确的菱形门控条件（例如，在从文档字符串生成到最终装配之前需要用户批准），该流程可确保代理无法绕过复杂任务并呈现未经验证的最终结果。

![HDoE195bEAABitY](HDoE195bEAABitY.jpg)

This pattern utilizes all optional directories, pulling in different reference files and templates only at the specific step where they are needed, keeping the context window clean.
此模式利用所有可选目录，仅在需要时才引入不同的参考文件和模板，从而保持上下文窗口的整洁。

In this documentation pipeline example, notice the explicit gate conditions. The agent is explicitly forbidden from moving to the assembly phase until the user confirms the generated docstrings in the previous step:
在这个文档流水线示例中，请注意明确的门控条件。在用户确认上一步生成的文档字符串之前，代理程序被明确禁止进入组装阶段：

```text
# skills/doc-pipeline/SKILL.md
---
name: doc-pipeline
description: Generates API documentation from Python source code through a multi-step pipeline. Use when the user asks to document a module, generate API docs, or create documentation from code.
metadata:
  pattern: pipeline
  steps: "4"
---

You are running a documentation generation pipeline. Execute each step in order. Do NOT skip steps or proceed if a step fails.

## Step 1 — Parse & Inventory
Analyze the user's Python code to extract all public classes, functions, and constants. Present the inventory as a checklist. Ask: "Is this the complete public API you want documented?"

## Step 2 — Generate Docstrings
For each function lacking a docstring:
- Load 'references/docstring-style.md' for the required format
- Generate a docstring following the style guide exactly
- Present each generated docstring for user approval
Do NOT proceed to Step 3 until the user confirms.

## Step 3 — Assemble Documentation
Load 'assets/api-doc-template.md' for the output structure. Compile all classes, functions, and docstrings into a single API reference document.

## Step 4 — Quality Check
Review against 'references/quality-checklist.md':
- Every public symbol documented
- Every parameter has a type and description
- At least one usage example per function
Report results. Fix issues before presenting the final document.
```

## Choosing the right agent skill pattern 选择合适的代理人技能模式

Each pattern answers a different question. Use this decision tree to find the right one for your use-case:
每种模式都回答不同的问题。请使用此决策树找到适合您用例的模式：

![HDoFWovXAAsbb8C](HDoFWovXAAsbb8C.jpg)

## And finally, patterns compose 最后，模式构成

These patterns are not mutually exclusive. They compose.
这些模式并非相互排斥，它们可以相互补充。

A Pipeline skill can include a Reviewer step at the end to double-check its own work. A Generator can rely on Inversion at the very beginning to gather the necessary variables before filling out its template. Thanks to ADK's 𝚂𝚔𝚒𝚕𝚕𝚃𝚘𝚘𝚕𝚜𝚎𝚝 and progressive disclosure, your agent only spends context tokens on the exact patterns it needs at runtime.
流水线技能可以在最后添加一个审核步骤，以再次检查自身的工作。生成器可以在开始时依赖反转来收集必要的变量，然后再填充其模板。得益于 ADK 的 𝚂𝚔𝚒𝚕𝚕𝚃𝚘𝚘𝚕𝚜𝚎𝚝 和渐进式披露，您的代理仅在运行时将其上下文令牌用于所需的确切模式。

Stop trying to cram complex and fragile instructions into a single system prompt. Break your workflows down, apply the right structural pattern, and build reliable agents.
不要试图将复杂且脆弱的指令塞进单个系统提示符中。分解工作流程，应用正确的结构模式，并构建可靠的代理。