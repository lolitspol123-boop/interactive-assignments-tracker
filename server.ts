import express from 'express';
import dotenv from 'dotenv';
import { GoogleGenAI, FunctionDeclaration, Type } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));

// Function declarations for coursework automation
const createAssignmentDeclaration: FunctionDeclaration = {
  name: 'create_assignment',
  description: 'Create a new coursework assignment or task in the student dashboard.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      title: {
        type: Type.STRING,
        description: 'The title or name of the assignment (e.g. "Calculus Problem Set 5", "Biology Lab Report")',
      },
      dueDate: {
        type: Type.STRING,
        description: 'The due date and time in ISO format YYYY-MM-DDTHH:MM (e.g. 2026-10-12T23:59)',
      },
      priority: {
        type: Type.STRING,
        description: 'Priority level: HIGH, MEDIUM, or LOW',
      },
      status: {
        type: Type.STRING,
        description: 'Initial status: TO_DO, IN_PROGRESS, or DONE',
      },
      notes: {
        type: Type.STRING,
        description: 'Optional assignment instructions, rubrics, or notes',
      },
    },
    required: ['title', 'dueDate'],
  },
};

const batchCreateAssignmentsDeclaration: FunctionDeclaration = {
  name: 'batch_create_assignments',
  description: 'Create multiple assignments or break down a large project into multiple milestone tasks.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      assignments: {
        type: Type.ARRAY,
        description: 'List of assignments to create',
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: 'Task title' },
            dueDate: { type: Type.STRING, description: 'Due date in YYYY-MM-DDTHH:MM' },
            priority: { type: Type.STRING, description: 'HIGH, MEDIUM, or LOW' },
            status: { type: Type.STRING, description: 'TO_DO, IN_PROGRESS, or DONE' },
            notes: { type: Type.STRING, description: 'Task notes or description' },
          },
          required: ['title', 'dueDate'],
        },
      },
    },
    required: ['assignments'],
  },
};

const updateAssignmentStatusDeclaration: FunctionDeclaration = {
  name: 'update_assignment_status',
  description: 'Update the status or properties of an existing assignment.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      id: {
        type: Type.STRING,
        description: 'The ID of the assignment to update',
      },
      newStatus: {
        type: Type.STRING,
        description: 'The new status: TO_DO, IN_PROGRESS, or DONE',
      },
      priority: {
        type: Type.STRING,
        description: 'Optional updated priority: HIGH, MEDIUM, or LOW',
      },
      dueDate: {
        type: Type.STRING,
        description: 'Optional updated due date in YYYY-MM-DDTHH:MM',
      },
    },
    required: ['id'],
  },
};

const deleteAssignmentDeclaration: FunctionDeclaration = {
  name: 'delete_assignment',
  description: 'Delete an assignment from the dashboard by its ID.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      id: {
        type: Type.STRING,
        description: 'The ID of the assignment to delete',
      },
      title: {
        type: Type.STRING,
        description: 'The title of the assignment (for verification/feedback)',
      },
    },
    required: ['id'],
  },
};

const bulkUpdateAssignmentsDeclaration: FunctionDeclaration = {
  name: 'bulk_update_assignments',
  description: 'Bulk update multiple assignments matching a condition (e.g. mark all overdue as In Progress).',
  parameters: {
    type: Type.OBJECT,
    properties: {
      filter: {
        type: Type.STRING,
        description: 'Condition: ALL_OVERDUE, ALL_TODO, or ALL_IN_PROGRESS',
      },
      newStatus: {
        type: Type.STRING,
        description: 'New status: TO_DO, IN_PROGRESS, or DONE',
      },
    },
    required: ['filter', 'newStatus'],
  },
};

const automationTools = [{
  functionDeclarations: [
    createAssignmentDeclaration,
    batchCreateAssignmentsDeclaration,
    updateAssignmentStatusDeclaration,
    deleteAssignmentDeclaration,
    bulkUpdateAssignmentsDeclaration,
  ],
}];

// API Route for multi-turn chat with Gemini automation
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, assignments = [], modelPreference, taskType } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages array is required.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: 'Gemini API key is not configured. Please ensure GEMINI_API_KEY is available in server environment.',
      });
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    // Select model according to user guidelines:
    // - gemini-3.1-pro-preview for particularly complex tasks
    // - gemini-3.5-flash for general tasks (default)
    // - gemini-3.1-flash-lite for tasks that should happen fast
    let selectedModel = 'gemini-3.5-flash';
    if (taskType === 'fast' || modelPreference === 'gemini-3.1-flash-lite') {
      selectedModel = 'gemini-3.1-flash-lite';
    } else if (taskType === 'complex' || modelPreference === 'gemini-3.1-pro-preview') {
      selectedModel = 'gemini-3.1-pro-preview';
    } else if (modelPreference === 'gemini-3.5-flash') {
      selectedModel = 'gemini-3.5-flash';
    }

    const now = new Date();
    const currentDateStr = now.toISOString();
    const localDateStr = now.toLocaleString();

    // Prepare assignments overview context for the AI
    const assignmentsContext = assignments.map((a: any) => ({
      id: a.id,
      title: a.title,
      dueDate: a.dueDate,
      priority: a.priority,
      status: a.status,
      notes: a.notes || '',
      filesCount: (a.files && a.files.length) || 0,
      isOverdue: a.status !== 'DONE' && new Date(a.dueDate).getTime() < now.getTime(),
    }));

    const systemInstruction = `You are Gemini Coursework Automator, an intelligent, multi-turn AI assistant built directly into the student's Assignment Tracker Web Dashboard.
Your role:
1. Help students manage, plan, prioritize, analyze, and automate their coursework tasks and deadlines.
2. Automate actions directly: When the user asks you to create, schedule, break down, edit, delete, or bulk-update assignments, invoke the appropriate function call tool (create_assignment, batch_create_assignments, update_assignment_status, delete_assignment, bulk_update_assignments).
3. The dashboard executes your function calls directly in the browser's local storage and updates the view immediately.
4. Current date and time: ${localDateStr} (ISO: ${currentDateStr}).
5. Current Assignments on the student's dashboard:
${JSON.stringify(assignmentsContext, null, 2)}

Guidelines:
- When calculating relative dates (e.g., "tomorrow", "this Friday", "next week"), compute the appropriate ISO date string YYYY-MM-DDTHH:MM relative to ${currentDateStr}. Default times to 23:59 if no time is specified.
- When the user asks you to break down a large project or paper, generate 3-5 realistic milestone tasks with progressive deadlines using batch_create_assignments.
- Always provide clear, encouraging, friendly conversational explanations in markdown alongside function calls.
- If no action is needed (e.g. asking for advice or a summary), answer thoughtfully and concisely.`;

    // Map conversation history to Gemini contents format
    const contents = messages.map((m: any) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.text || '' }],
    }));

    const response = await ai.models.generateContent({
      model: selectedModel,
      contents,
      config: {
        systemInstruction,
        tools: automationTools,
      },
    });

    const replyText = response.text || '';
    const functionCalls = response.functionCalls || [];

    return res.json({
      reply: replyText,
      functionCalls,
      modelUsed: selectedModel,
    });
  } catch (error: any) {
    console.error('Gemini chat error:', error);
    return res.status(500).json({
      error: error.message || 'An error occurred while contacting the Gemini model.',
    });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(Number(port), '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${port}`);
  });
}

startServer();
