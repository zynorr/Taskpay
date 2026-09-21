// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SimpleAccount} from "../src/aa/samples/SimpleAccount.sol";
import {SimpleAccountFactory} from "../src/aa/samples/SimpleAccountFactory.sol";
import {IEntryPoint} from "../src/aa/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "../src/aa/interfaces/PackedUserOperation.sol";
import {
    SIG_VALIDATION_FAILED,
    SIG_VALIDATION_SUCCESS,
    ValidationData,
    _parseValidationData
} from "../src/aa/core/Helpers.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract SessionKeyTest is Test {
    SimpleAccount account;
    SimpleAccountFactory factory;
    address entryPoint = makeAddr("entryPoint");
    address taskpay = makeAddr("taskpay");
    address owner;
    address session;

    uint256 constant OWNER_KEY = 0xA11CE;
    uint256 constant SESSION_KEY = 0xB0B;

    bytes4 constant ACCEPT = bytes4(keccak256("acceptTask(uint256)"));
    bytes4 constant SUBMIT = bytes4(keccak256("submitWork(uint256,string)"));

    function setUp() public {
        owner = vm.addr(OWNER_KEY);
        session = vm.addr(SESSION_KEY);
        // SimpleAccount is proxy-deployed: the implementation disables
        // initializers, so create it through the real factory.
        factory = new SimpleAccountFactory(IEntryPoint(entryPoint));
        account = factory.createAccount(owner, 0);
    }

    function _sign(uint256 key, bytes32 userOpHash) internal returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, MessageHashUtils.toEthSignedMessageHash(userOpHash));
        return abi.encodePacked(r, s, v);
    }

    function _execute(address target, uint256 value, bytes4 selector) internal returns (bytes memory) {
        return abi.encodeCall(account.execute, (target, value, abi.encodeWithSelector(selector, uint256(1))));
    }

    function _validate(bytes memory callData, bytes memory sig, bytes32 userOpHash) internal returns (uint256) {
        PackedUserOperation memory op = PackedUserOperation({
            sender: address(account),
            nonce: 0,
            initCode: "",
            callData: callData,
            accountGasLimits: bytes32(0),
            preVerificationGas: 0,
            gasFees: bytes32(0),
            paymasterAndData: "",
            signature: sig
        });
        vm.prank(entryPoint);
        return account.validateUserOp(op, userOpHash, 0);
    }

    function _authorize(address key, uint48 validUntil, bytes4 selector) internal {
        address[] memory targets = new address[](1);
        targets[0] = taskpay;
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = selector;
        vm.prank(owner);
        account.authorizeSession(key, validUntil, targets, selectors);
    }

    function test_ownerSignatureStillValid() public {
        bytes32 h = keccak256("owner-op");
        assertEq(_validate(_execute(taskpay, 0, ACCEPT), _sign(OWNER_KEY, h), h), SIG_VALIDATION_SUCCESS);
    }

    function test_sessionKeyValidForAllowedCall() public {
        uint48 until = uint48(block.timestamp + 1 days);
        _authorize(session, until, ACCEPT);
        bytes32 h = keccak256("session-op");
        ValidationData memory d = _parseValidationData(_validate(_execute(taskpay, 0, ACCEPT), _sign(SESSION_KEY, h), h));
        assertEq(d.aggregator, address(0));
        assertEq(d.validAfter, 0);
        assertEq(d.validUntil, until);
    }

    function test_sessionKeyRejectsWrongSelector() public {
        _authorize(session, uint48(block.timestamp + 1 days), ACCEPT);
        bytes32 h = keccak256("wrong-selector");
        assertEq(_validate(_execute(taskpay, 0, SUBMIT), _sign(SESSION_KEY, h), h), SIG_VALIDATION_FAILED);
    }

    function test_sessionKeyRejectsWrongTarget() public {
        _authorize(session, uint48(block.timestamp + 1 days), ACCEPT);
        bytes32 h = keccak256("wrong-target");
        assertEq(_validate(_execute(makeAddr("other"), 0, ACCEPT), _sign(SESSION_KEY, h), h), SIG_VALIDATION_FAILED);
    }

    function test_sessionKeyRejectsValue() public {
        _authorize(session, uint48(block.timestamp + 1 days), ACCEPT);
        bytes32 h = keccak256("with-value");
        assertEq(_validate(_execute(taskpay, 1 ether, ACCEPT), _sign(SESSION_KEY, h), h), SIG_VALIDATION_FAILED);
    }

    function test_sessionKeyRejectsRevoked() public {
        _authorize(session, uint48(block.timestamp + 1 days), ACCEPT);
        vm.prank(owner);
        account.revokeSession(session);
        bytes32 h = keccak256("revoked");
        assertEq(_validate(_execute(taskpay, 0, ACCEPT), _sign(SESSION_KEY, h), h), SIG_VALIDATION_FAILED);
    }

    function test_unregisteredKeyRejected() public {
        bytes32 h = keccak256("unregistered");
        assertEq(_validate(_execute(taskpay, 0, ACCEPT), _sign(SESSION_KEY, h), h), SIG_VALIDATION_FAILED);
    }

    function test_sessionKeyRejectsExecuteBatchShape() public {
        _authorize(session, uint48(block.timestamp + 1 days), ACCEPT);
        address[] memory dests = new address[](1);
        dests[0] = taskpay;
        uint256[] memory vals = new uint256[](1);
        bytes[] memory funcs = new bytes[](1);
        funcs[0] = abi.encodeWithSelector(ACCEPT, uint256(1));
        bytes memory batch = abi.encodeCall(account.executeBatch, (dests, vals, funcs));
        bytes32 h = keccak256("batch");
        assertEq(_validate(batch, _sign(SESSION_KEY, h), h), SIG_VALIDATION_FAILED);
    }

    function test_authorizeSessionOnlyOwner() public {
        address[] memory targets = new address[](1);
        targets[0] = taskpay;
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = ACCEPT;
        vm.prank(session);
        vm.expectRevert("only owner");
        account.authorizeSession(session, uint48(block.timestamp + 1 days), targets, selectors);
    }

    function test_revokeSessionOnlyOwner() public {
        vm.prank(session);
        vm.expectRevert("only owner");
        account.revokeSession(session);
    }

    function test_authorizeSessionRejectsEmptyScope() public {
        address[] memory targets = new address[](0);
        bytes4[] memory selectors = new bytes4[](0);
        vm.prank(owner);
        vm.expectRevert("account: empty scope");
        account.authorizeSession(session, uint48(block.timestamp + 1 days), targets, selectors);
    }

    function test_authorizeSessionRejectsZeroValidUntil() public {
        address[] memory targets = new address[](1);
        targets[0] = taskpay;
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = ACCEPT;
        vm.prank(owner);
        vm.expectRevert("account: validUntil required");
        account.authorizeSession(session, 0, targets, selectors);
    }
}
