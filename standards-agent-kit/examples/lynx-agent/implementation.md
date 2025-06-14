# Lynx Agent Implementation Plan

## 1. Diagnosis of Current Issues

After reviewing the code and comparing with all examples (standards-expert, langchain-demo, cli-demo), we've identified several critical issues:

1. **Improper Message Fetching**: LynxAgent is using `getMessages()` instead of `getMessageStream()` which the standards-expert uses.

2. **Error Handling**: Implementation isn't properly handling errors when messages can't be parsed as JSON or when the structure isn't as expected.

3. **Connection Management**: The LynxAgent isn't fully leveraging the SDK's ConnectionsManager functionality which handles much of the connection logic.

4. **Agent Registration**: We haven't integrated with the proper agent registration flow like other examples do.

5. **Errors observed**:
   - `Invalid JSON message content: Test direct execute on inbound: 1747245211783`
   - `Error fetching messages: Cannot read properties of undefined (reading 'filter')`

## 2. Standards-Expert Approach Analysis

After detailed examination of the standards-expert implementation, we've discovered:

1. **Message Fetching Strategy**:
   - Uses `getMessageStream()` consistently (`const { messages } = await this.client.getMessageStream(topicId);`)
   - Does NOT use CheckMessagesTool for getting messages, but implements its own logic

2. **Connection Handling**:
   - Gets connections using `stateManager.listConnections().filter(conn => conn.status === 'established')`
   - Validates topic IDs with regex pattern: `topicId.match(/^[0-9]+\.[0-9]+\.[0-9]+$/)`

3. **Message Tracking**:
   - Uses three tracking mechanisms:
     1. `lastProcessedTimestamps` - Map to track timestamps by topic
     2. `processedMessages` - Set to track processed sequence numbers
     3. `messagesInProcess` - Set to track messages being processed
   - Initializes timestamp to one day ago if not present
   - Updates timestamp after successful message processing

4. **Message Filtering**:
   - Sorts messages by sequence number
   - Filters based on multiple criteria:
     ```typescript
     const newMessages = messages.filter(
       (m) =>
         m.op === 'message' &&
         m.created &&
         m.created.getTime() > lastTimestamp &&
         m.operator_id &&
         !m.operator_id.includes(this.accountId) &&
         m.sequence_number !== undefined &&
         !processedSet.has(m.sequence_number) &&
         !inProcessSet.has(m.sequence_number)
     );
     ```

5. **Error Recovery**:
   - Processes each message in a try/catch block
   - Continues processing remaining messages even if one fails
   - Properly cleans up in-process tracking in finally block

6. **Connection Monitoring**:
   - Uses ConnectionMonitorTool with acceptAll option:
     ```typescript
     const monitorResult = await this.connectionMonitorTool.invoke({
       acceptAll: true,
       monitorDurationSeconds: 5,
     });
     ```

## 3. Comprehensive Message Handling Comparison

After reviewing all examples in the standards-agent-kit, here's a detailed comparison of message handling approaches:

### 1. Standards-Expert Agent Approach:
- Uses direct `getMessageStream()` method from client
- Implements custom message tracking with three mechanisms:
  - `lastProcessedTimestamps` for timestamp tracking
  - `processedMessages` for tracking processed sequence numbers
  - `messagesInProcess` for tracking currently processing messages
- Handles filtering and message extraction internally
- Directly invokes `sendMessageTool` for responses
- Full control over message handling logic
- Best for complex processing needs or high-throughput scenarios

### 2. CLI Demo Approach:
- Uses `CheckMessagesTool` exclusively
- Delegates all message handling to the tool
- Simple invocation with just the target identifier:
  ```typescript
  const result = await checkMessagesTool.invoke({
    targetIdentifier: connection.targetAccountId,
    lastMessagesCount: 10,
  });
  ```
- Tool handles timestamp tracking internally
- Tool provides formatted output ready for display
- Best for simple implementations or when you need human-readable output

### 3. LangChain Demo:
- Uses `CheckMessagesTool` through LangChain agent
- Provides detailed instructions to the agent on how to use tools
- The agent makes decisions about which tool to use based on user input
- Simplified approach for AI assistant interfaces
- Best for user-interactive scenarios

### 4. CheckMessagesTool Implementation:
- Uses client's `getMessages()` method (not `getMessageStream()`)
- Has a timestamp tracking mechanism using stateManager
- Can both fetch only new messages or fetch latest messages:
  - `fetchLatest: false` (default) - Only get new messages since last check
  - `fetchLatest: true` - Get latest messages regardless of timestamp
- Handles HCS-3 inscriptions automatically
- Formats messages with timestamps and sequence numbers
- Provides human-readable output

## 4. Key SDK Components Not Properly Utilized

From reviewing other examples, we found that the LynxAgent isn't properly leveraging several critical SDK components:

1. **ConnectionsManager**: The SDK provides a robust ConnectionsManager class that handles:
   - Connection tracking
   - Connection state management
   - Connection status updates
   - Message timestamp tracking

2. **RegisterAgentTool**: We need to properly register the agent with:
   - Agent capabilities
   - Proper connection points
   - Optional fee configuration 
   - Profile information

3. **State Management**: OpenConvaiState provides:
   - Thread-safe connection management
   - Timestamp tracking for messages
   - Connection status management
   - Integration with the ConnectionsManager

4. **Standard Tool Implementations**: We should use the standard tools:
   - `ConnectionTool` for monitoring connections
   - `InitiateConnectionTool` for starting connections
   - `SendMessageTool` for sending messages
   - CustomMessageCheck with `getMessageStream()` like standards-expert

## 5. Implementation Priorities

### Priority 1: Proper Agent Registration

```typescript
// Make sure agent is properly registered
const registerAgentTool = new RegisterAgentTool(this.client, this.stateManager);
const registrationResult = await registerAgentTool.invoke({
  name: "Lynx Agent",
  description: "A helpful AI assistant using Hedera Consensus Service",
  capabilities: [0], // TEXT_GENERATION
  setAsCurrent: true,
});
```

### Priority 2: Proper ConnectionsManager Integration

```typescript
// Initialize ConnectionsManager through stateManager
this.connectionsManager = this.stateManager.initializeConnectionsManager(
  this.client.standardClient
);

// Use proper connection methods
const connections = this.stateManager
  .listConnections()
  .filter((conn) => conn.status === 'established');
```

### Priority 3: Implement Standards-Expert Message Handling

Instead of using the CheckMessagesTool, we should implement the same pattern as the standards-expert:

```typescript
// Get established connections through stateManager
const connections = this.stateManager
  .listConnections()
  .filter((conn) => conn.status === 'established');

for (const conn of connections) {
  const topicId = conn.connectionTopicId;
  
  // Validate topic ID format
  if (!topicId.match(/^[0-9]+\.[0-9]+\.[0-9]+$/)) {
    continue;
  }

  try {
    // Use getMessageStream like standards-expert
    const { messages } = await this.client.getMessageStream(topicId);
    
    // Initialize and track timestamps
    // Filter messages
    // Process each message with proper error handling
  } catch (err) {
    // Continue with next connection
  }
}
```

### Priority 4: Implement Robust Error Handling

```typescript
try {
  // Existing code...
} catch (err) {
  this.logger.error(
    `Error fetching messages for topic ${topicId}: ${err}`
  );
  // Continue with next connection instead of failing completely
}
```

## 6. Message Processing Workflow

Based on the standards-expert example, the correct message processing workflow should be:

1. Get established connections from the stateManager
2. For each connection:
   - Validate the topic ID format
   - Use `getMessageStream()` to get messages
   - Initialize timestamp tracking if needed
   - Filter for new messages using multiple criteria
   - Process each message with proper error handling
   - Update timestamp tracking after each successful processing
   - Clean up in-process tracking in finally block

## 7. Testing Approach

1. **Test Agent Registration**:
   - Register the agent using RegisterAgentTool
   - Verify the agent is registered in the SDK's state

2. **Test Connection Management**:
   - Use ConnectionTool to monitor for incoming connections
   - Use InitiateConnectionTool to start outgoing connections
   - Verify connections appear in stateManager.listConnections()

3. **Test Message Exchange**:
   - Send messages with SendMessageTool
   - Receive messages with the standards-expert approach
   - Verify timestamps and sequence tracking

## 8. Fix Current Code Issues

### Fix LynxAgent.ts Protected Method Access
```typescript
// Replace protected _call() access with public methods
// In acceptConnectionRequest():
const result = await this.acceptConnectionTool.acceptConnectionRequest({
  uniqueRequestKey: requestKey
});

// In checkForNewMessages():
// Use the toolkit's public methods or create wrapper functions
```

### Update Message Handling to Match Standards-Expert
```typescript
// Use getMessageStream like the standards-expert
const { messages } = await this.client.getMessageStream(topicId);

// Implement robust message tracking and filtering
```

## 9. Integration with Moonscape

Since we have the Moonscape topic IDs in our environment variables, we'll:

1. Connect directly to Moonscape's topics
2. Log all interactions with timestamps for debugging
3. Use console.log for visibility into the message flow

## 10. Implementation Steps

1. Update the agent initialization to properly register with the SDK
2. Properly initialize ConnectionsManager through stateManager
3. Update message handling to match the standards-expert implementation
4. Implement robust error handling in all message processing
5. Fix the connection monitoring logic to use the standard tools
6. Test with real connections to verify message processing

## 11. Implementation Decision

Based on the comprehensive analysis of all examples, the recommended approach for LynxAgent message handling is:

1. **Primary Approach**: Use the Standards-Expert direct implementation
   - Provides full control over message handling logic
   - Better handling of complex filtering needs
   - More explicit tracking of processed messages
   - No extra tool layer adding complexity

2. **Alternate Approach**: Use CheckMessagesTool when:
   - Simple implementation is prioritized over performance
   - Human-readable formatted output is needed
   - Complex message tracking isn't required
   - You're building a user-interactive agent (like in langchain-demo.ts)

For our Lynx Agent, we'll implement the Standards-Expert approach because:
1. It provides the most direct and efficient message handling
2. It gives us full control over the message processing logic
3. It matches the implementation pattern used in the most sophisticated example
4. It lets us customize the response generation process more easily
5. It allows for better error handling and recovery 

## 12. Implementation Pattern Analysis

After reviewing the SDK documentation and examples in depth, here are the key patterns we need to follow:

### Message Handling Pattern Analysis

1. **Connection Topics vs. Inbound Topics**
   - **Connection Topics**: Use `getMessageStream()` for established connections
   - **Inbound Topics**: Use `getMessages()` but with careful error handling

2. **Standards-Expert Implementation**
   - Uses `getMessageStream()` for established connection topics
   - Implements robust filtering logic:
     ```typescript
     const newMessages = messages.filter(
       (m) =>
         m.op === 'message' &&
         m.created &&
         m.created.getTime() > lastTimestamp &&
         m.operator_id &&
         !m.operator_id.includes(this.accountId) &&
         m.sequence_number !== undefined &&
         !processedSet.has(m.sequence_number) &&
         !inProcessSet.has(m.sequence_number)
     );
     ```
   - Has separate tracking for messages being processed to avoid duplicate handling
   - Properly handles message parsing errors in individual message processing

3. **ConnectionTool Implementation**
   - The SDK's ConnectionTool uses `getMessages()` on inbound topics to look for connection requests
   - It has specialized filtering logic for connection requests:
     ```typescript
     const connectionRequests = allMessages.filter(
       (msg) =>
         msg.op === 'connection_request' &&
         typeof msg.sequence_number === 'number'
     );
     ```
   - Continues monitoring even after errors via try/catch blocks around each message

4. **ConnectionMonitorTool Implementation**
   - When monitoring connections, also uses `getMessages()` but with robust filtering
   - Limits monitoring to a specific duration using `monitorDurationSeconds`
   - Uses state manager to mark connection requests as processed
   - Has explicit logic to handle duplicate requests

5. **Error Handling Differences**
   - ConnectionTool and ConnectionMonitorTool have error handling around the entire getMessages call
   - Standards-expert has error handling around individual message processing
   - Our implementation lacks the needed try/catch blocks in critical places

### Implementation Deficiencies

Our implementation has several deficiencies compared to the standards:

1. We're not handling non-JSON messages properly in the ConnectionTool
2. We don't have the proper tracking for already processed messages
3. We're not correctly distinguishing between connection topics and inbound topics
4. Our filtering logic isn't as robust as the standards-expert implementation
5. Our error handling isn't covering all failure modes, especially at the message processing level

### Fixes Required

To align with the standards:

1. For established connections: Use `getMessageStream()` with robust filtering
2. For monitoring inbound topics: Use `getMessages()` with special filtering and try/catch
3. Implement proper tracking for processed messages and timestamps
4. Add error handling around both the message retrieval and individual message processing
5. Use the ConnectionsManager from StateManager consistently

### Strategy Update

Rather than trying to reinvent the wheel, we should:

1. Follow the ConnectionTool pattern for monitoring inbound topics
2. Follow the standards-expert pattern for checking established connections
3. Fix our error handling at both the loop level and the individual message level
4. Utilize the SDK's state tracking more effectively 

## 13. Implementation Updates

The following updates have been made to the LynxAgent implementation:

### Message Handling Updates

1. **Updated Message Fetching Strategy**
   - Updated `checkForNewMessages()` to follow the standards-expert pattern
   - Now using `getMessageStream()` for established connections
   - Implemented robust message filtering with multiple criteria
   - Added proper timestamp tracking for each topic
   - Added in-process message tracking to prevent duplicate processing

2. **Improved Error Handling**
   - Added multi-level error handling:
     - Top-level try/catch for the entire connection loop
     - Mid-level try/catch for each connection's message fetching
     - Low-level try/catch for individual message processing
   - Added error recovery to continue processing after failures
   - Added proper cleanup in finally blocks

3. **Enhanced HCS10Client Patching**
   - Added more comprehensive error detection patterns
   - Patched both `getMessages()` and `getMessageStream()` methods
   - Added specific handling for different types of errors:
     - Invalid JSON errors
     - Undefined property errors
   - Patched both the client and standardClient implementations

4. **Improved Connection Monitoring**
   - Updated `startMonitoring()` to set up continuous connection monitoring
   - Added proper parameters to the ConnectionTool
   - Implemented periodic connection status checks
   - Added automatic acceptance of connection requests

5. **Message Processing**
   - Improved `handleStandardMessage()` with better error handling
   - Added fallback logic for non-JSON messages
   - Added sequence number validation
   - Implemented robust message content extraction

### Results

These changes align the LynxAgent with the proven patterns from the standards-expert implementation, which should resolve the issues with:
- "Invalid JSON message content" errors
- "Cannot read properties of undefined" errors
- Message tracking and processing
- Connection monitoring and management

The updated implementation now properly leverages the SDK's features while adding robust error handling at all levels. 

## 14. Rate Limiting Improvements

After observing status code 429 (Too Many Requests) errors when querying topic messages, the following rate-limiting improvements have been implemented:

### 1. Exponential Backoff with Jitter

We implemented a comprehensive rate limiting solution with exponential backoff and jitter:

- **Topic-specific backoff tracking**: Each topic is tracked separately for backoff status
- **Exponential backoff**: Retry delays increase exponentially with the number of failures
- **Jitter**: Random variation (30%) added to retry times to prevent synchronized retries
- **Maximum backoff caps**: Starting at 1 minute and gradually increasing to a maximum of 5 minutes
- **Successful call reset**: Backoff state is reset after successful calls

### 2. Polling Frequency Adjustments

- **Reduced polling frequency**: Changed from 5 seconds to 10 seconds to match standards-expert
- **Non-overlapping polls**: Added isPolling flag to prevent multiple overlapping polling cycles
- **Staggered monitoring**: Connection monitoring now runs only every other polling cycle
- **Inter-topic delays**: Added small delays between checking different topics

### 3. Graceful Error Handling

- **Skipping rate-limited topics**: Topics that hit rate limits are temporarily removed from polling
- **Empty results instead of errors**: Rate-limited calls return empty message arrays instead of errors
- **Prioritized connection handling**: Connection monitoring is now less frequent than message checking

### 4. Results

These changes should significantly reduce the number of 429 errors by:
- Automatically adapting to Hedera's rate limits
- Reducing the total number of API calls
- Spreading out calls over time
- Providing progressive backoff when limits are reached

The agent now prioritizes stable operation over immediacy of message delivery, which is appropriate for a long-running service. 