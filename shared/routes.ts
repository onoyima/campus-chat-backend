import { z } from 'zod';
import { chatIdentities, conversations, messages, participants, notifications, statusUpdates, calls } from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
  forbidden: z.object({
    message: z.string(),
  }),
};

export const api = {
  // Identity Management
  identity: {
    me: {
      method: 'GET' as const,
      path: '/api/identity/me',
      responses: {
        200: z.custom<typeof chatIdentities.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    list: {
      method: 'GET' as const,
      path: '/api/identities', 
      input: z.object({
        search: z.string().optional(),
        role: z.string().optional(),
        departmentId: z.coerce.number().optional(),
      }).optional(),
      responses: {
        200: z.array(z.custom<typeof chatIdentities.$inferSelect>()),
      },
    },
  },

  // Conversations
  conversations: {
    list: {
      method: 'GET' as const,
      path: '/api/conversations',
      responses: {
        200: z.array(z.object({
          id: z.number(),
          type: z.string(),
          name: z.string().nullable(),
          lastMessage: z.custom<typeof messages.$inferSelect>().optional(),
          unreadCount: z.number(),
          participants: z.array(z.custom<typeof participants.$inferSelect>()),
        })),
      },
    },
    createDirect: {
      method: 'POST' as const,
      path: '/api/conversations/direct',
      input: z.object({
        targetIdentityId: z.number(),
      }),
      responses: {
        201: z.custom<typeof conversations.$inferSelect>(),
        400: errorSchemas.validation,
        403: errorSchemas.forbidden, 
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/conversations/:id',
      responses: {
        200: z.object({
          conversation: z.custom<typeof conversations.$inferSelect>(),
          participants: z.array(z.custom<typeof chatIdentities.$inferSelect>()), 
        }),
        404: errorSchemas.notFound,
      },
    },
  },

  // Messages
  messages: {
    list: {
      method: 'GET' as const,
      path: '/api/conversations/:id/messages',
      input: z.object({
        cursor: z.coerce.number().optional(),
        limit: z.coerce.number().default(50),
      }).optional(),
      responses: {
        200: z.array(z.custom<typeof messages.$inferSelect>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/conversations/:id/messages',
      input: z.object({
        content: z.string().min(1),
        type: z.enum(['text', 'file', 'voice_note', 'audio', 'image', 'video']).default('text'),
        metadata: z.any().optional(),
      }),
      responses: {
        201: z.custom<typeof messages.$inferSelect>(),
        403: errorSchemas.forbidden,
      },
    },
  },

  // Notifications
  notifications: {
    list: {
        method: 'GET' as const,
        path: '/api/notifications',
        responses: {
            200: z.array(z.custom<typeof notifications.$inferSelect>()),
        },
    },
    markRead: {
        method: 'POST' as const,
        path: '/api/notifications/:id/read',
        responses: {
            200: z.object({ success: z.boolean() }),
        },
    },
  },

  // Status Updates
  status: {
    list: {
        method: 'GET' as const,
        path: '/api/status-updates',
        responses: {
            200: z.array(z.custom<typeof statusUpdates.$inferSelect>()),
        },
    },
    create: {
        method: 'POST' as const,
        path: '/api/status-updates',
        input: z.object({
            content: z.string().optional(),
            mediaUrl: z.string().optional(),
        }),
        responses: {
            201: z.custom<typeof statusUpdates.$inferSelect>(),
        },
    },
  },

  // Calls
  calls: {
    initiate: {
        method: 'POST' as const,
        path: '/api/calls/initiate',
        input: z.object({
            targetIdentityId: z.number(),
            type: z.enum(['voice', 'video']),
        }),
        responses: {
            201: z.custom<typeof calls.$inferSelect>(),
        },
    },
    list: {
        method: 'GET' as const,
        path: '/api/calls',
        responses: {
            200: z.array(z.custom<typeof calls.$inferSelect>()),
        },
    },
  },

  // Admin
  admin: {
    users: {
        method: 'GET' as const,
        path: '/api/admin/users',
        responses: {
            200: z.array(z.custom<typeof chatIdentities.$inferSelect>()),
        },
    },
  },


  // System / Debug
  debug: {
    switchIdentity: {
      method: 'POST' as const,
      path: '/api/debug/switch-identity',
      input: z.object({
        identityId: z.number(),
      }),
      responses: {
        200: z.object({ success: z.boolean() }),
      },
    },
    seed: {
      method: 'POST' as const,
      path: '/api/debug/seed',
      responses: {
        200: z.object({ message: z.string() }),
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
