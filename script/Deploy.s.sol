// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {TaskPay} from "../src/TaskPay.sol";

/// @notice Deploys TaskPay. Constructor args come from env:
///   ORACLE_ADDRESS        — oracle EOA (or empty string for deployer)
///   CHALLENGE_WINDOW      — seconds, default 3 days
///   SENIOR_ARBITER_WINDOW — seconds, default 1 day
/// Usage:
///   forge script script/Deploy.s.sol \
///     --rpc-url <RPC> --private-key $PRIVATE_KEY --broadcast
/// Deployer becomes contract owner.
contract Deploy is Script {
    function run() external returns (TaskPay taskpay) {
        uint256 pk = vm.envUint("PRIVATE_KEY");

        // envOr is ambiguous across overloads in current forge-std; read raw
        // strings and fall back to defaults ourselves.
        string memory rawOracle = vm.envOr("ORACLE_ADDRESS", string(""));
        address oracle = bytes(rawOracle).length == 0 ? vm.addr(pk) : vm.parseAddress(rawOracle);

        string memory rawChallenge = vm.envOr("CHALLENGE_WINDOW", string(""));
        uint256 challengeWindow = bytes(rawChallenge).length == 0 ? 3 days : vm.parseUint(rawChallenge);

        string memory rawSenior = vm.envOr("SENIOR_ARBITER_WINDOW", string(""));
        uint256 seniorArbiterWindow = bytes(rawSenior).length == 0 ? 1 days : vm.parseUint(rawSenior);

        vm.startBroadcast(pk);
        taskpay = new TaskPay(oracle, challengeWindow, seniorArbiterWindow);
        vm.stopBroadcast();

        console2.log("TaskPay deployed at:", address(taskpay));
        console2.log("oracle:", taskpay.oracle());
        console2.log("challengeWindow:", taskpay.challengeWindow());
        console2.log("seniorArbiterWindow:", taskpay.seniorArbiterWindow());
        console2.log("owner:", taskpay.owner());
    }
}
