// tests/hcs10/HCS10Client.test.ts

import * as dotenv from "dotenv";
dotenv.config();
import { HCS10Client } from "../../src/hcs10/HCS10Client";
import { TopicCreateTransaction, TopicMessageSubmitTransaction } from "@hashgraph/sdk";
import { PrivateKey } from "@hashgraph/sdk";
import { Client } from "@hashgraph/sdk";
import { AgentMetadata } from "../../src/hcs10/types";
import { RegisterAgentTool } from "../../src/tools/RegisterAgentTool";
import { SendMessageTool } from "../../src/tools/SendMessageTool";
import { ConnectionTool } from "../../src/tools/ConnectionTool";

// Mocking the Hedera SDK's TopicCreateTransaction execute method.
jest.mock("@hashgraph/sdk", () => {
    const originalModule = jest.requireActual("@hashgraph/sdk");
    return {
        ...originalModule,
        TopicCreateTransaction: class {
            private memo: string = '';

            setTopicMemo(memo: string) {
                this.memo = memo;
                return this;
            }

            execute(client: any) {
                // Return different topic IDs based on the memo
                const topicId = this.memo.includes("Inbound") ? "0.0.1111" : "0.0.2222";
                return Promise.resolve({
                    getReceipt: () => Promise.resolve({ topicId: { toString: () => topicId } })
                });
            }
        },
        TopicMessageSubmitTransaction: class {
            setTopicId(topicId: string) {
                return this;
            }
            setMessage(message: string) {
                return this;
            }
            execute(client: any) {
                return Promise.resolve({
                    getReceipt: () => Promise.resolve({ status: "SUCCESS" })
                });
            }
        }
    };
});

// Mock the standard SDK client if needed, or provide dummy operator details
const dummyOperatorId = "0.0.12345";
const dummyPrivateKey = PrivateKey.generateED25519().toString(); // Generate a dummy key
const dummyNetwork = "testnet";

describe("HCS10Client", () => {
    let dummyClient: Client; // Keep if needed for other tests, or remove
    let hcsClient: HCS10Client;

    beforeEach(() => {
        // Mock the base @hashgraph/sdk client if necessary for parts of tests
        dummyClient = {} as Client; // Simple mock, enhance if needed
        // dummyClient.operatorAccountId = AccountId.fromString(dummyOperatorId);

        // Instantiate with new constructor
        hcsClient = new HCS10Client(dummyOperatorId, dummyPrivateKey, dummyNetwork);

        // Mock methods on the internal standardClient if necessary for testing
        // jest.spyOn(hcsClient['standardClient'], 'someMethod').mockResolvedValue(...);
    });

    // Removed test for setupAgentChannels as the method is gone
    // test("should setup agent channels", async () => { ... });

    // Updated test for createAndRegisterAgent (NEEDS REVIEW)
    test("should create and register an agent", async () => {
        const metadata: AgentMetadata = {
            name: "Test Agent",
            // description: "...", // Add other fields as needed
        };

        // Mock the standardClient's createAndRegisterAgent method
        const mockResult = {
            metadata: {
                accountId: "0.0.54321",
                privateKey: "dummy-agent-private-key",
                publicKey: "dummy-agent-public-key",
                inboundTopicId: "0.0.60001",
                outboundTopicId: "0.0.60002",
                profileTopicId: "0.0.60003"
            }
            // Add other expected fields from the standard SDK result
        };
        const mockStandardClient = hcsClient['standardClient'] as any; // Access private member for mocking
        mockStandardClient.createAndRegisterAgent = jest.fn().mockResolvedValue(mockResult);

        const result = await hcsClient.createAndRegisterAgent(metadata);

        // Assertions need to be updated based on the expected mockResult structure
        expect(result).toBeDefined();
        expect(result.metadata).toBeDefined();
        expect(result.metadata.accountId).toEqual(mockResult.metadata.accountId);
        expect(mockStandardClient.createAndRegisterAgent).toHaveBeenCalled();

        // Verify agentChannels property is updated (optional)
        expect(hcsClient.agentChannels?.inboundTopicId).toEqual(mockResult.metadata.inboundTopicId);
    });

    // Removed test for registerAgent as the method is gone
    // test("should register an agent", async () => { ... });

    // Keep and update tests for sendMessage, getMessages, getMessageContent if they exist
    // Ensure mocks target the standardClient methods (e.g., submitMessage, getMessages)
});
