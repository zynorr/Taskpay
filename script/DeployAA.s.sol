// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {SimpleAccountFactory} from "../src/aa/samples/SimpleAccountFactory.sol";
import {VerifyingPaymaster} from "../src/aa/samples/VerifyingPaymaster.sol";
import {IEntryPoint} from "../src/aa/interfaces/IEntryPoint.sol";

/// @notice Deploys the ERC-4337 sponsor stack for gasless TaskPay UX:
///   - SimpleAccountFactory — counterfactual smart accounts owned by each user's EOA
///   - VerifyingPaymaster   — sponsors gas; trusts a signer (the oracle/bundler) to approve ops
///
/// EntryPoint is the canonical v0.7 deployment, already live on BOT Chain:
///   0x0000000071727De22E5E9d8BAf0edAc6f37da032 (bytecode-identical to mainnet).
///
/// Env:
///   PRIVATE_KEY         — deployer (becomes paymaster owner)
///   ENTRY_POINT         — optional, defaults to the canonical v0.7 address
///   VERIFYING_SIGNER    — optional, defaults to deployer; the key the bundler signs
///                         sponsorship approvals with (the oracle uses ORACLE_PRIVATE_KEY)
///
/// Usage:
///   forge script script/DeployAA.s.sol \
///     --rpc-url <RPC> --private-key $PRIVATE_KEY --broadcast
contract DeployAA is Script {
    function run() external returns (SimpleAccountFactory factory, VerifyingPaymaster paymaster) {
        uint256 pk = vm.envUint("PRIVATE_KEY");

        string memory rawEntry = vm.envOr("ENTRY_POINT", string(""));
        address entryPoint = bytes(rawEntry).length == 0
            ? 0x0000000071727De22E5E9d8BAf0edAc6f37da032
            : vm.parseAddress(rawEntry);

        string memory rawSigner = vm.envOr("VERIFYING_SIGNER", string(""));
        address verifyingSigner = bytes(rawSigner).length == 0 ? vm.addr(pk) : vm.parseAddress(rawSigner);

        vm.startBroadcast(pk);
        factory = new SimpleAccountFactory(IEntryPoint(entryPoint));
        paymaster = new VerifyingPaymaster(IEntryPoint(entryPoint), verifyingSigner);
        vm.stopBroadcast();

        console2.log("SimpleAccountFactory deployed at:", address(factory));
        console2.log("VerifyingPaymaster deployed at:", address(paymaster));
        console2.log("entryPoint:", address(entryPoint));
        console2.log("verifyingSigner:", verifyingSigner);
        console2.log("paymaster owner:", paymaster.owner());
    }
}