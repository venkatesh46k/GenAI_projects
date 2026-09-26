/**
 * GENERATED from contracts/ai-service.openapi.json. Do not edit by hand.
 * Regenerate with `npm run gen:ai-types` after `python -m ai_service.export_openapi`.
 */

export interface paths {
    "/chat": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Chat */
        post: operations["chat_chat_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/chat/stream": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Chat Stream */
        post: operations["chat_stream_chat_stream_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/evidence/{name}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Evidence */
        get: operations["evidence_evidence__name__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Health */
        get: operations["health_health_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** ChatRequest */
        ChatRequest: {
            /**
             * Msisdn
             * @description The customer open in the console, used as context when the question names no number.
             */
            msisdn?: string | null;
            /**
             * Query
             * @description What the agent typed.
             */
            query: string;
        };
        /** ChatResponse */
        ChatResponse: {
            /**
             * Answer
             * @description The reply after moderation: safe to show to the agent.
             */
            answer: string;
            /** Dispute Id */
            dispute_id?: string | null;
            /** Pii Masked */
            pii_masked: boolean;
            /**
             * Route
             * @description rag | balance | dispute | escalation | testgen
             */
            route: string;
            /**
             * Route Method
             * @description regex | llm: how the route was decided.
             */
            route_method: string;
            /**
             * Safety Flag
             * @description Set when the safety check blocked the reply.
             */
            safety_flag?: string | null;
            /**
             * Sources
             * @description Knowledge-base passages the answer was built from.
             */
            sources?: string[];
            test_result?: components["schemas"]["TestResult"] | null;
            /** Ticket Id */
            ticket_id?: string | null;
            /**
             * Tool Calls
             * @description Billing calls the agents made.
             */
            tool_calls?: {
                [key: string]: unknown;
            }[];
        };
        /**
         * ErrorEvent
         * @description The `error` server-sent event: the request failed; `detail` is safe to show.
         */
        ErrorEvent: {
            /** Detail */
            detail: string;
        };
        /** HTTPValidationError */
        HTTPValidationError: {
            /** Detail */
            detail?: components["schemas"]["ValidationError"][];
        };
        /** HealthResponse */
        HealthResponse: {
            /** Model */
            model: string;
            /** Provider */
            provider: string;
            /**
             * Ready
             * @description False until the models have finished loading (the first minutes after start).
             */
            ready: boolean;
            /**
             * Status
             * @constant
             */
            status: "ok";
        };
        /**
         * StepEvent
         * @description One `step` server-sent event: an agent node finished.
         */
        StepEvent: {
            /** Message */
            message: string;
            /** Node */
            node: string;
        };
        /** TestResult */
        TestResult: {
            /** Detail */
            detail: string;
            /**
             * Evidence Url
             * @description Path to the screenshot, relative to this service.
             */
            evidence_url?: string | null;
            /**
             * Status
             * @enum {string}
             */
            status: "pass" | "fail";
            /** Steps Completed */
            steps_completed?: number | null;
        };
        /** ValidationError */
        ValidationError: {
            /** Context */
            ctx?: Record<string, never>;
            /** Input */
            input?: unknown;
            /** Location */
            loc: (string | number)[];
            /** Message */
            msg: string;
            /** Error Type */
            type: string;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    chat_chat_post: {
        parameters: {
            query?: never;
            header?: {
                "x-internal-token"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChatRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ChatResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    chat_stream_chat_stream_post: {
        parameters: {
            query?: never;
            header?: {
                "x-internal-token"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChatRequest"];
            };
        };
        responses: {
            /** @description Server-sent events. `step` (StepEvent) as each agent finishes, comment lines as keep-alives, then exactly one `result` (ChatResponse) or `error` (ErrorEvent), then `done`. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                    "text/event-stream": string;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    evidence_evidence__name__get: {
        parameters: {
            query?: never;
            header?: {
                "x-internal-token"?: string | null;
            };
            path: {
                name: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    health_health_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthResponse"];
                };
            };
        };
    };
}
