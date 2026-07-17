export const RESPONSE = {
    type: 'object',
    properties: {
        findings: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    threatId: { type: 'string', description: 'LINDDUN GO threat ID, e.g. "L1", "I1", or "N/A" if not applicable' },
                    category: { type: 'string', enum: ['Linking', 'Identifying', 'Non-repudiation'] },
                    title: { type: 'string' },
                    description: { type: 'string', description: 'Explanation of the specific concern found in this code' },
                    location: {
                        type: 'object',
                        properties: {
                            startLine: { type: 'number' },
                            endLine: { type: 'number' },
                            snippet: { type: 'string', description: 'The exact code excerpt that triggered this finding' }
                        },
                        required: ['startLine', 'endLine', 'snippet']
                    },
                    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
                    recommendation: { type: 'string' }
                },
                required: ['threatId', 'category', 'title', 'description', 'location', 'confidence', 'recommendation']
            }
        }
    },
    required: ['findings']
} as const;