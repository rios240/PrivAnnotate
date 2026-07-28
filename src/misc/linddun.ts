export type ThreatType = 
    | 'Linking' | 'Identifying' | 'Non-repudiation' | 'Detecting'   
    | 'Data Disclosure' | 'Unawareness & Unintervenability' | 'Non-compliance'


export interface Threat {
    id: string,
    type: ThreatType,
    threat: string,
    description: string,
    elicitation: string[],
    examples: string[],
    hotspot: string
}

export const THREATS: Threat[] = [

    // ---- Tier 1 ----
    {
        id: 'L1',
        type: 'Linking',
        threat: 'Linked User Requests',
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
    {
        id: 'I1',
        type: 'Identifying',
        threat: 'Identified User Requests',
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
    {
        id: 'Nr1',
        type: 'Non-repudiation',
        threat: 'Non-repudiation of Service Usage',
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
    {
        id: 'D1',
        type: 'Detecting',
        threat: 'Detectable Users',
        description: 'Inferring the existence of a user from the system\'s response',
        elicitation: [
            'Does the system show status messages (informational, warnings, errors) when retrieving data?',
            'Are the status messages distinct when an item (a file, user, ...) does not exist compared to not having access rights?'
        ],
        examples: [
            'A \'wrong password\' error message reveals the existence of the account.',
            'A firewall responding with \'port closed\' reveals the existence of a device at the IP address.'
        ],
        hotspot: 'Outbound Flows'
    },
    {
        id: 'DD1',
        type: 'Data Disclosure',
        threat: 'Excessively Sensitive Data Collected',
        description: 'The system acquires more sensitive or finegrained data than strictly necessary for its functionality.',
        elicitation: [
            'Is the data more sensitive than strictly necessary?',
            'Is the data more fine-grained than strictly necessary?',
            'Does the data encoding include additional (meta)data?'
        ],
        examples: [
            'Tracking a patient\'s weight is pertinent for dieting apps but not for a contract tracing application.',
            'A smart meter shares realtime measurements rather than the aggregated consumption.',
            'A camera application on a smartphone does not necessarily need to record the picture\'s location.'
        ],
        hotspot: 'Inbound Personal Data'
    },
    {
        id: 'U1',
        type: 'Unawareness & Unintervenability',
        threat: 'Insufficient Transparency',
        description: 'Data subjects are insufficiently informed about the collection and processing of their personal data.',
        elicitation: [
            'Are data subjects insufficiently informed about the processing of personal data, including the purposes and methods of the processing involved?'
        ],
        examples: [
            'Data subjects are not aware of the identities of the third parties with whom their data will be shared.',
            'The privacy notice provided to the data subject was not presented in clear and plain language.',
            'Data subjects are unaware the traffic cameras collect not only number plates but also facial images.'
        ],
        hotspot: 'Inbound User with Personal Data'
    },
    {
        id: 'Nc1',
        type: 'Non-compliance',
        threat: 'Non-compliance of Processing with Applicable Regulations',
        description: 'The processing of personal data by the system is not compliant with applicable privacy regulations.',
        elicitation: [
            'Will the system be used in jurisdictions with specific rules for personal data processing (e.g., the EU)?',
            'Does the system, or its processing activities, violate one or more rules in these applicable regulation(s)?'
        ],
        examples: [
            'The system processes information of EU citizens without a valid legal ground under GDPR.',
            'The system shares user information with third parties, violating \'Do Not Sell My Data\' rights under the CCPA.'
        ],
        hotspot: 'Processing Personal Data'
    },

    // ---- Tier 2 ----
    {
        id: 'L2',
        type: 'Linking',
        threat: 'Linkable User Requests',
        description: 'User requests can be linked because  they contain attributes that can be combined into quasi-identifiers.',
        elicitation: [
            'Is there a set of attributes that can serve as an identifier?',
            'Is there other data sent together with that quasi-identifier?',
            'Is there existing data to link it to?'
        ],
        examples: [
            'A small set of locations can be used to uniquely link activity to a single user.',
            'A subset of attributes may be sufficient to uniquely link data to a particular individual.',
            'A browser fingerprint combines properties (OS, browser, display size, ...) that together are unique to a website visitor.'
        ],
        hotspot: 'Inbound Personal Data'
    },
    {
        id: 'I2',
        type: 'Identifying',
        threat: 'Identifiable User Requests',
        description: 'The user can be identified because the data in their requests can be used to infer who they are.',
        elicitation: [
            'Are requests or records sufficiently unique to differentiate them from those of a specific individual?'
        ],
        examples: [
            'User search queries, such as looking up nearby businesses or info about a rare illness, can be highly specific and may lead to identification.',
            'A person\'s consistent access at a particular time each week could link their visits even when they are not logged into their account.'
        ],
        hotspot: 'Inbound User'
    },
    {
        id: 'Nr2',
        type: 'Non-repudiation',
        threat: 'Non-repudiation of Sending',
        description: 'Users cannot deny having sent a message.',
        elicitation: [
            'Is the data digitally signed?',
            'Which keys are used for signing? Who has access to these keys to verify signatures?'
        ],
        examples: [
            'A digitally signed email prevents the user from later denying having written the message.',
            'A common spam countermeasure (DKIM) involves signing outgoing emails, this prevents users from denying the authenticity of leaked or stolen emails.'
        ],
        hotspot: 'Inbound User'
    },
    {
        id: 'D2',
        type: 'Detecting',
        threat: 'Detectable Service Usage',
        description: 'Detecting communication between a service and its users.',
        elicitation: [
            'Can the communication be observed?',
            'Can information be inferred from the observed communications?'
        ],
        examples: [
            'Observing communication with a service to infer that a person is a user (e.g., adult website).',
            'Communication with a telemedicine service implies the user is a patient.',
            'Participation in the Tor network can be determined by observing traffic.'
        ],
        hotspot: 'In/Outbound User'
    },
    {
        id: 'DD2',
        type: 'Data Disclosure',
        threat: 'Excessive Amount of Data Collected',
        description: 'The system acquires more data than strictly needed for its functionality.',
        elicitation: [
            'Is the amount of collected data necessary for the correct functioning of the system?',
            'Is the processing frequency necessary?',
            'Are there more data subjects involved than necessary?'
        ],
        examples: [
            'A generic service that is not age-restricted should not request a user\'s age.',
            'Recording patient weight on a weekly or monthly basis may suffice; collecting such information every half hour is unnecessary.',
            'Posts on social networks frequently include personal data about other individuals.'
        ],
        hotspot: 'Inbound Personal Data'
    },
    {
        id: 'U2',
        type: 'Unawareness & Unintervenability',
        threat: 'Insufficient Information when Sharing Data of Others',
        description: 'When sharing personal data of others,  users are insufficiently informed about the further data processing.',
        elicitation: [
            'If a user shares personal data of others, is it clear what, why, and how  that data is further processed?'        ],
        examples: [
            'A user posting a picture on social media may not be aware that others in the picture are automatically tagged with a facial recognition system.',
            'Using a DNA testing service can entail sharing medical information about family members.',
            'A service invites a user to share their address book to find contacts on a service.'
        ],
        hotspot: 'Inbound Personal Data'
    },
    {
        id: 'Nc2',
        type: 'Non-compliance',
        threat: 'Non-adherence to Privacy Standards',
        description: 'The system is not compliant with privacy standards and best practices.',
        elicitation: [
            'Are there any (industry) specific privacy standards that are applicable to  the system?',
            'Does the system adequately implement the principles and controls  outlined in these standards?'
        ],
        examples: [
            'The system does not adhere to the best practices and principles outlined in the relevant ISO norms on data protection and privacyby-design.',
            'Privacy risks are not classified and managed using a standardized methodology such as the NIST Privacy Framework.'
        ],
        hotspot: 'Processing Personal Data'
    },

    // ---- Tier 3 ----
    {
        id: 'L3',
        type: 'Linking',
        threat: 'Linking Through Distinguishable Patterns',
        description: 'Patterns in the (meta)data contained in user requests can be used to link them to each other.',
        elicitation: [
            'Is the data from different individuals distinguishable?',
            'Is it possible to query data using distinguishable attributes?'
        ],
        examples: [
            'Unique timing patterns could be recognized to link the use of a service to the same user.',
            'Messages can be analyzed for patterns (e.g., writing style, timing) to link them to the same user.'
        ],
        hotspot: 'Inbound User'
    },
    {
        id: 'I3',
        type: 'Identifying',
        threat: 'Identifiable Data Flows',
        description: 'Data sent to the system is sufficiently  revealing to identify the user.',
        elicitation: [
            'Is there free-form user provided data that is received or processed by the system?',
            'Is data collected that may reveal the identifying information?'
        ],
        examples: [
            'When an individual shares detailed data (such as location, employer, device type, etc.) in a feedback form, the provided information may be revealing enough to uniquely identify that person.'
        ],
        hotspot: 'Inbound Personal Data'
    },
    {
        id: 'Nr3',
        type: 'Non-repudiation',
        threat: 'Non-repudiation of Receipt',
        description: 'Users cannot deny having received a message.',
        elicitation: [
            'Do (passive) interactions with the system (e.g., receiving a message) have side-effects (e.g., trigger transmissions, logging)?',
            'Is deniability of receipt a desired feature for the system?'
        ],
        examples: [
            'Read notifications serve as evidence that the user has opened/read the message.',
            'An individual\'s browser history may be used to substantiate claims about their online activities.',
            'Actions can be logged as evidence.'
        ],
        hotspot: 'Outbound User'
    },
    {
        id: 'D3',
        type: 'Detecting',
        threat: 'Detectable Events',
        description: 'Detecting side effects or communications triggered by application events.',
        elicitation: [
            'Do actions in the system have side effects (e.g., saving a file, writing to a log, triggering other transmissions)?',
            'Are these side effects observable?'
        ],
        examples: [
            'Log files on a shared system reveal applications used or actions taken by other users.',
            'Deleted applications may leave behind traces (configuration, temporary files).',
            'When steganography is used to hide data, the increased file size may still indicate the existence of that hidden data.'
        ],
        hotspot: 'In/Outbound Flows'
    },
    {
        id: 'DD3',
        type: 'Data Disclosure',
        threat: 'Unnecessary Data Analysis',
        description: 'Data is further processed, analyzed, or enriched in a way that is not strictly necessary for the functionality.',
        elicitation: [
            'Is the data enrichment/analysis necessary for the system\'s functionality?'
        ],
        examples: [
            'A camera application on a smartphone does not need to perform face-based recognition or emotion detection.',
            'Analyzing a user\'s blog posts for language proficiency is unnecessary for blogging functionality.',
            'User profiles accumulate unnecessary details over time, tracking a broad range of actions or service usage that is not essential for the provided functionality.'
        ],
        hotspot: 'Processing Personal Data'
    },
    {
        id: 'U3',
        type: 'Unawareness & Unintervenability',
        threat: 'Insufficient Privacy Controls',
        description: 'Data subjects have insufficient controls to manage their preferences.',
        elicitation: [
            'Does the system enable the data subject to configure which personal data is processed and for what purposes?',
            'Can the data subject alter their preferences afterwards?'
        ],
        examples: [
            'The data subject is unable to set appropriate preferences on which data is shared and why.',
            'The data subject is unable to set their consent preferences for the processing of personal data.'
        ],
        hotspot: 'Inbound User'
    },
    {
        id: 'Nc3',
        type: 'Non-compliance',
        threat: 'Improper Data Lifecycle Management',
        description: 'Data is not properly managed throughout its entire lifecycle within the system.',
        elicitation: [
            'Is there a data lifecycle management policy defined for the data processed within the system?',
            'Does the policy outline clear principles for each phase of the data lifecycle (creation, storage, sharing and usage, archival, and destruction)?'
        ],
        examples: [
            'There is no clear policy or mechanism to enforce deletion of data that is no longer needed.',
            'The organizational roles and responsibilities surrounding data management in the system are not sufficiently defined.'
        ],
        hotspot: 'Processing'
    },
 
    // ---- Tier 4 ----
    {
        id: 'L4',
        type: 'Linking',
        threat: 'Linkable Dataset',
        description: 'Stored personal data can be linked to individuals.',
        elicitation: [
            'Is there a set of attributes that can serve as an identifier?',
            'Is there other data sent together with that quasi-identifier?',
            'Is there existing data to link it to?'
        ],
        examples: [
            'Fine-grained raw data is stored that enables linking specific entries to individuals.',
            'Querying the average salary with a strict set of criteria can reveal the salary of an individual employee.',
            'Patterns in a person\'s writing style can be used to link multiple texts written by the same person.'
        ],
        hotspot: 'Storing/Retrieving'
    },
    {
        id: 'I4',
        type: 'Identifying',
        threat: 'Identifiers in Data Requests',
        description: 'Communication contains (quasi-)identifiers.',
        elicitation: [
            'Is there a distinctive identifier used during interactions or when referring to an individual\'s data?',
            'Can multiple attributes be combined to create a unique reference to an individual or their data?'
        ],
        examples: [
            'The (re)use of an email address facilitates easy combination with other data, leading to the identification of the individual.',
            'IP addresses in communication can be used to uniquely identify an individual.',
            'Browser fingerprinting entails the combination of various properties to create a unique identifier, serving as a pseudonym for the user.'
        ],
        hotspot: 'Inbound User with Personal Data'
    },
    {
        id: 'Nr4',
        type: 'Non-repudiation',
        threat: 'Non-repudiation of Storage',
        description: 'Users cannot deny claims about data stored in non-repudiable storage.',
        elicitation: [
            'Is the data digitally signed?',
            'Which keys are used for signing? Who has access to these keys to verify signatures?'
        ],
        examples: [
            'Data stored on a blockchain cannot be modified, eliminating the deniability of claims related to this data.'
        ],
        hotspot: 'Storage'
    },
    {
        id: 'D4',
        type: 'Detecting',
        threat: 'Detectable Records',
        description: 'Detecting the existence of records in a system.',
        elicitation: [
            'Does the system show status messages (informational, warnings, errors) when retrieving data?',
            'Are the status messages distinct when an item (a file, user, ...) does not exist compared to not having access rights?'
        ],
        examples: [
            'An error message stating \'insufficient access rights\' may inadvertently leak the existence of a specific record.',
            'An error message stating \'address already registered\' when subscribing to a political newsletter reveals a current member.'
        ],
        hotspot: 'Retrieving'
    },
    {
        id: 'DD4',
        type: 'Data Disclosure',
        threat: 'Unnecessary Data Retention',
        description: 'Data is stored for longer than needed.',
        elicitation: [
            'Is the data stored for longer time than necessary?'
        ],
        examples: [
            'Retaining the email addresses of newsletter subscribers long after they have unsubscribed.'
        ],
        hotspot: 'Storage'
    },
    {
        id: 'U4',
        type: 'Unawareness & Unintervenability',
        threat: 'Insufficient Access',
        description: 'Data subjects do not have access to their personal data.',
        elicitation: [
            'Do data subjects lack the ability to access the personal data being collected, processed, stored, or disclosed about them?'
        ],
        examples: [
            'It is not possible for a data subject to request access, neither directly through the system nor indirectly through a helpdesk.',
            'The sensor data from a wearable is transmitted to a lifestyle tracking app, but the user cannot access statistics and information derived from their data.'
        ],
        hotspot: 'Storing'
    },
    {
        id: 'Nc4',
        type: 'Non-compliance',
        threat: 'Insufficient Security of Processing',
        description: 'Data security measures and processes do not adhere to risk and security management best practices and standards.',
        elicitation: [
            'Is there an established process to manage security risks and identify the required countermeasures?',
            'Does the system incorporate the required countermeasures?',
            'Are the countermeasures aligned with industry standards and best practices?'
        ],
        examples: [
            'No security assessment was performed of the software.',
            'There are no processes in place to ensure software and services are kept up to date.',
            'The organization does not use appropriate access control mechanisms to limit access of employees to personal data.'
        ],
        hotspot: 'Processing'
    },
 
    // ---- Tier 5 ----
    {
        id: 'L5',
        type: 'Linking',
        threat: 'Profiling Users',
        description: 'Users can be profiled by analyzing their data for patterns.',
        elicitation: [
            'Are there patterns derivable from the data?',
            'Can (new) personal data be inferred from the linked data points?'
        ],
        examples: [
            'By applying sentiment analysis to faces in pictures, the emotional state of an individual can be derived.',
            'The frequency of data exchanges from a health monitoring device allows an adversary to infer a patient\'s medical condition.'
        ],
        hotspot: 'Processing'
    },
    {
        id: 'I5',
        type: 'Identifying',
        threat: 'Identifiable Dataset',
        description: 'Stored data can be used to identify individuals.',
        elicitation: [
            'Can multiple attributes be combined to create a unique reference to an individual or their data?',
            'Is there a distinctive identifier used during interactions or when referring to an individual\'s data?'
        ],
        examples: [
            'A dataset removes names and reduces addresses to cities. Nevertheless, a combination of various attributes (city, birth date, language preference, etc.) could still be adequate to identify individuals.'
        ],
        hotspot: 'Storage'
    },
    {
        id: 'Nr5',
        type: 'Non-repudiation',
        threat: 'Non-repudiation of Hidden Data or Metadata',
        description: 'Hidden or metadata in a document prevent users from denying claims associated with it.',
        elicitation: [
            'Does stored or transmitted data have associated metadata?',
            'Are there embedded data or hidden patterns in the data or transmissions?',
            'Does this data lead to undesirable deniability issues?'
        ],
        examples: [
            'Author or revision metadata in documents prevents deniability.',
            'Data watermarked with hidden artifacts (uniquely linked to a person) can be used to track the person revealing or disclosing the data afterwards.',
            'Remote resources (e.g. image in email) are automatically loaded to track the user opening it.'
        ],
        hotspot: 'Processing'
    },
    {
        id: 'DD5',
        type: 'Data Disclosure',
        threat: 'Overexposure of Personal Data',
        description: 'Personal data is shared with more services or external parties than necessary.',
        elicitation: [
            'Is the data necessary for the recipient?',
            'Are there more parties involved than necessary?',
            'How accessible is the data (public/limited/private)?'
        ],
        examples: [
            'Location data from a navigation application is propagated to all the other applications (e.g., calendar, mail).',
            'Personal data is disclosed to other users of the service.',
            'In a medical application, while collecting patient weight data is deemed necessary, making such datasets publicly available would be unnecessary and harmful.'
        ],
        hotspot: 'Outbound Personal Data'
    },
    {
        id: 'U5',
        type: 'Unawareness & Unintervenability',
        threat: 'Insufficient Rectification or Erasure',
        description: 'Data subjects cannot rectify or erase their personal data.',
        elicitation: [
            'Do data subjects have the ability to correct or delete their personal data?'
        ],
        examples: [
            'The data subject is unable to correct their personal data.',
            'When a data subject deletes their social media account, the account is disabled, but the actual data is not erased.',
            'A data subject is unable to update their home address after relocating.'
        ],
        hotspot: 'Retrieving'
    }
];
