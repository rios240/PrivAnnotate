export const RESPONSE = {
    type: 'object',
    properties: {
        threatId: { type: 'string', description: 'LINDDUN GO threat card ID, e.g. "L1", "I1", or "N/A" if not applicable.' },
        title: { type: 'string', description: 'A title for this threat.' },
        summary: { type: 'string', description: 'A summary of the specific concern found in this code.' },
        location: {
            type: 'object',
            properties: {
                startLine: { type: 'number' },
                endLine: { type: 'number' }
            },
            required: ['startLine', 'endLine']
        },
        consequences: { type: 'string', description: 'The potential consequences of the identified threat.' },
        remediation: { type: 'string', description: 'Suggestions for addressing the identified threat.' }
    },
    required: ['threatId', 'title', 'summary', 'location', 'consequences', 'remediation']
} as const;