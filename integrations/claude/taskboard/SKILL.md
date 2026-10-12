---
name: taskboard
description: Record progress on the user's taskboard (their desktop task widget) with the `task` command. Use when the user says which task the current work belongs to ("现在做任务 3", "this is for task 3", "更新任务进度"), asks about their tasks or deadlines, or asks you to record progress on a task or step.
---

# taskboard

The user tracks their work in taskboard: tasks with due dates, each split into steps with 0–100 progress. A small desktop window shows it. You update it with the `task` command so the user can see what you have done.

## Rules

1. Use the `task` command only. Never read or edit the data file (`~/.taskboard/tasks.json`) directly.
2. Sign every update with `--by claude`.
3. Update progress only after the user has told you which task the current work belongs to. If they have not, change nothing; you may ask once.
4. Update a step only when it has really moved. Mark a step done only after you have verified the work (tests pass, the file exists, the command ran).
5. Do not create, rename or delete tasks or steps unless the user asks. If your work does not match any existing step, say so instead of inventing one.
6. If a `task` command fails, report its error message. Do not work around it.
7. In your reply, say which task and step you updated and to what.

## Commands

Look before you update:

```
task list                 # all tasks: id, progress, due date, name
task show 3 --json        # task 3 with its steps and their ids
```

Update:

```
task done 3 2 --by claude            # step 2 of task 3 is finished
task progress 3 2 60 --by claude     # step 2 of task 3 is about 60% done
task progress 3 40 --by claude       # task 3 has no steps: set the task itself
```

Only when the user asks:

```
task add "Name" --due 2026-10-20
task step add 3 "Step name"
```

Run `task --help` for everything else.
