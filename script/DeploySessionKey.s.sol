// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {SimpleAccount} from "../src/aa/samples/SimpleAccount.sol";
import {IEntryPoint} from "../src/aa/interfaces/IEntryPoint.sol";

/// @notice Deploys the session-key-enabled SimpleAccount *implementation*.
///         Existing account proxies (created by SimpleAccountFactory) are
///         upgraded to it by their owner via `upgradeToAndCall(impl, "")` —
///         the proxy address stays the same, so a bot keeps its identity,
///         funds, and reputation while gaining scoped-session-key signing.
///
/// Env:
///   ENTRY_POINT — optional, defaults to the canonical v0.7 address
///
/// Usage:
///   forge script script/DeploySessionKey.s.sol \
///     --rpc-url https://rpc.botchain.ai --private-key $PRIVATE_KEY --broadcast
///
/// After deploying, upgrade each account proxy that should gain session keys
/// (signed by that account's OWNER key, not necessarily the deployer):
///   cast send <ACCOUNT_PROXY> "upgradeToAndCall(address,bytes)" \
///     <IMPL_ADDRESS> 0x --private-key <OWNER_KEY>
contract DeploySessionKey is Script {
    function run() external returns (SimpleAccount implementation) {
        uint256 pk = vm.envUint("PRIVATE_KEY");

        string memory rawEntry = vm.envOr("ENTRY_POINT", string(""));
        address entryPoint = bytes(rawEntry).length == 0
            ? 0x0000000071727De22E5E9d8BAf0edAc6f37da032
            : vm.parseAddress(rawEntry);

        vm.startBroadcast(pk);
        implementation = new SimpleAccount(IEntryPoint(entryPoint));
        vm.stopBroadcast();

        console2.log("Session-key SimpleAccount implementation:");
        console2.logAddress(address(implementation));
        console2.log("entryPoint:");
        console2.logAddress(entryPoint);
    }
}
