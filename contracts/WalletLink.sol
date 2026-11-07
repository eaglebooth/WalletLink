// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract WalletLink {
    struct Request {
        bytes32 solanaKey;
        uint256 id;
        uint256 expiresAt;
    }

    mapping(address => Request) public pending;
    mapping(address => bytes32) public solanaOf;
    mapping(bytes32 => address) public evmOf;
    uint256 public requestCount;

    error InvalidPair();
    error AlreadyLinked();
    error InvalidRequest();
    error WrongWallet();

    event Requested(address indexed evm, bytes32 indexed solanaKey, uint256 id, uint256 expiresAt);
    event Cancelled(address indexed evm, uint256 id);
    event Linked(address indexed evm, bytes32 indexed solanaKey);
    event Revoked(address indexed evm, bytes32 indexed solanaKey);

    function syntheticAddress(bytes32 solanaKey) public pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(solanaKey)))));
    }

    function request(bytes32 solanaKey) external {
        if (solanaKey == bytes32(0) || msg.sender == syntheticAddress(solanaKey)) revert InvalidPair();
        if (solanaOf[msg.sender] != bytes32(0) || evmOf[solanaKey] != address(0)) revert AlreadyLinked();
        uint256 id = ++requestCount;
        uint256 expiresAt = block.timestamp + 1 days;
        pending[msg.sender] = Request(solanaKey, id, expiresAt);
        emit Requested(msg.sender, solanaKey, id, expiresAt);
    }

    function cancel(uint256 id) external {
        if (id == 0 || pending[msg.sender].id != id) revert InvalidRequest();
        delete pending[msg.sender];
        emit Cancelled(msg.sender, id);
    }

    function accept(address evm, uint256 id) external {
        Request memory proposal = pending[evm];
        if (id == 0 || proposal.id != id || block.timestamp >= proposal.expiresAt) revert InvalidRequest();
        if (msg.sender != syntheticAddress(proposal.solanaKey)) revert WrongWallet();
        if (solanaOf[evm] != bytes32(0) || evmOf[proposal.solanaKey] != address(0)) revert AlreadyLinked();
        delete pending[evm];
        solanaOf[evm] = proposal.solanaKey;
        evmOf[proposal.solanaKey] = evm;
        emit Linked(evm, proposal.solanaKey);
    }

    function revoke(address evm, bytes32 expectedSolanaKey) external {
        bytes32 solanaKey = solanaOf[evm];
        if (solanaKey == bytes32(0) || solanaKey != expectedSolanaKey) revert InvalidPair();
        if (msg.sender != evm && msg.sender != syntheticAddress(solanaKey)) revert WrongWallet();
        delete solanaOf[evm];
        delete evmOf[solanaKey];
        emit Revoked(evm, solanaKey);
    }
}
