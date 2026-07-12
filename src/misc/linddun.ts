export type ThreatType = 
    | 'Linking' | 'Identifying' | 'Non-repudiation' | 'Detecting'   
    | 'Data Disclosure' | 'Unawareness' | 'Non-compliance'


export interface Threat {
    id: string,
    type: ThreatType,
    title: string,
    description: string,
    elicitation: string[],
    examples: string[],
    hotspot: string
}

export const LINKING_THREATS: Threat[] = [
    {
        id: 'L1',
        type: 'Linking',
        title: 'Linked User Requests',
        description: 'User requests can be linked because they contain a unique identifier.',
        elicitation: [
            'Is there an identifier (unique in system/session) or dataset?',
            'Is there other data associated with that identifier?',
            'Is there previous data with the same identifier to which new data can be linked?'
        ],
        examples: [
            'Using an email address as an identifier enables the linking of all activities to the same individual, even across multiple services.',
            'An IP address can be used to link multiple visits to the same individual.',
            'All product views in a web shop are linked to the same user because they are logged in.'
        ],
        hotspot: 'Inbound User with Personal Data'
    },
];

export const IDENTIFYING_THREATS: Threat[] = [
    {
        id: 'I1',
        type: 'Identifying',
        title: 'Identified User Requests',
        description: 'The incoming user requests contain data that directly reveals the user identity.',
        elicitation: [
            'Does data sent to the system (potentially) contain identity data?',
        ],
        examples: [
            'An online service requests full name and address during the registration process.',
            'The username for a service contains identity data (e.g., \"firstname.lastname\").'
        ],
        hotspot: 'Inbound User with Personal Data'
    },
];

export const NON_REPUDIATION_THREATS: Threat[] = [
    {
        id: 'Nr1',
        type: 'Non-repudiation',
        title: 'Non-repudiation of Service Usage',
        description: 'Users cannot deny having used a service because of authentication or logged access.',
        elicitation: [
            'Does the system record data affecting deniability?',
            'Does the data itself impact deniability claims?'
        ],
        examples: [
            'An account with a corporate email address eliminates the employee\'s deniability of having used that service.',
            'System administrators can access log files linking an entry in an internal complaint system to the individual employee.'
        ],
        hotspot: 'In/Outbound User'
    },
];
