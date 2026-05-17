import { z } from 'zod';

// ─── Shared filter sub-schema ─────────────────────────────────────────────────

const filtersSchema = z.object({
    profile: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).optional(),
    filters: z.object({
        job_titles:    z.array(z.string().max(100)).max(200).optional(),
        ignore_titles: z.array(z.string().max(100)).max(200).optional(),
        countries:     z.array(z.string().max(100)).max(50).optional(),
        states:        z.array(z.string().max(100)).max(60).optional(),
        states_abbr:   z.array(z.string().max(10)).max(60).optional(),
        posting_diff:  z.number().int().min(1).max(365).optional(),
    }).optional(),
}).strict();

// ─── Route-specific schemas ───────────────────────────────────────────────────

const workdayBodySchema = filtersSchema.extend({
    file_name: z.enum(['wday1', 'wday2', 'wday3']).optional(),
});

const diceBodySchema = filtersSchema.extend({
    page_number: z.number().int().min(1).max(100).optional(),
});

const greenhouseBodySchema = filtersSchema.extend({
    embed: z.boolean().optional(),
});

// ─── Middleware factory ───────────────────────────────────────────────────────

/**
 * Returns an Express middleware that validates req.body against the given
 * Zod schema. Responds with 400 on validation failure.
 */
const validateBody = (schema) => (req, res, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
        return res.status(400).json({
            error: {
                message: 'Invalid request body',
                details: result.error.issues.map(e => ({ path: e.path.join('.'), message: e.message })),
                timestamp: new Date().toISOString(),
            },
        });
    }
    req.body = result.data; // replace with parsed/coerced data
    next();
};

export const validateGreenhouse = validateBody(greenhouseBodySchema);
export const validateWorkday    = validateBody(workdayBodySchema);
export const validateDice       = validateBody(diceBodySchema);
export const validateFilters    = validateBody(filtersSchema);
