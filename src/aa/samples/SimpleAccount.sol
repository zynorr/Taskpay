// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.23;

/* solhint-disable avoid-low-level-calls */
/* solhint-disable no-inline-assembly */
/* solhint-disable reason-string */

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import "../core/BaseAccount.sol";
import "../core/Helpers.sol";
import "./callback/TokenCallbackHandler.sol";

/**
  * minimal account.
  *  this is sample minimal account.
  *  has execute, eth handling methods
  *  has a single signer that can send requests through the entryPoint.
  */
contract SimpleAccount is BaseAccount, TokenCallbackHandler, UUPSUpgradeable, Initializable {
    address public owner;

    // --- Session keys -------------------------------------------------- //
    // A session key is a scoped, expiring signer the owner grants limited
    // authority to — e.g. an agent bot that may only accept/submit on TaskPay
    // and can never move value. validUntil == 0 means "not authorized"; the
    // EntryPoint enforces expiry via the time-range in the validationData.
    mapping(address => uint48) public sessionValidUntil;
    mapping(address => mapping(address => mapping(bytes4 => bool))) public allowedSessionCalls;

    IEntryPoint private immutable _entryPoint;

    event SimpleAccountInitialized(IEntryPoint indexed entryPoint, address indexed owner);
    event SessionAuthorized(address indexed key, uint48 validUntil, address[] targets, bytes4[] selectors);
    event SessionRevoked(address indexed key);

    modifier onlyOwner() {
        _onlyOwner();
        _;
    }

    /// @inheritdoc BaseAccount
    function entryPoint() public view virtual override returns (IEntryPoint) {
        return _entryPoint;
    }

    // solhint-disable-next-line no-empty-blocks
    receive() external payable {}

    constructor(IEntryPoint anEntryPoint) {
        _entryPoint = anEntryPoint;
        _disableInitializers();
    }

    function _onlyOwner() internal view {
        //directly from EOA owner, or through the account itself (which gets redirected through execute())
        require(msg.sender == owner || msg.sender == address(this), "only owner");
    }

    /**
     * execute a transaction (called directly from owner, or by entryPoint)
     * @param dest destination address to call
     * @param value the value to pass in this call
     * @param func the calldata to pass in this call
     */
    function execute(address dest, uint256 value, bytes calldata func) external {
        _requireFromEntryPointOrOwner();
        _call(dest, value, func);
    }

    /**
     * execute a sequence of transactions
     * @dev to reduce gas consumption for trivial case (no value), use a zero-length array to mean zero value
     * @param dest an array of destination addresses
     * @param value an array of values to pass to each call. can be zero-length for no-value calls
     * @param func an array of calldata to pass to each call
     */
    function executeBatch(address[] calldata dest, uint256[] calldata value, bytes[] calldata func) external {
        _requireFromEntryPointOrOwner();
        require(dest.length == func.length && (value.length == 0 || value.length == func.length), "wrong array lengths");
        if (value.length == 0) {
            for (uint256 i = 0; i < dest.length; i++) {
                _call(dest[i], 0, func[i]);
            }
        } else {
            for (uint256 i = 0; i < dest.length; i++) {
                _call(dest[i], value[i], func[i]);
            }
        }
    }

    /**
     * @dev The _entryPoint member is immutable, to reduce gas consumption.  To upgrade EntryPoint,
     * a new implementation of SimpleAccount must be deployed with the new EntryPoint address, then upgrading
      * the implementation by calling `upgradeTo()`
      * @param anOwner the owner (signer) of this account
     */
    function initialize(address anOwner) public virtual initializer {
        _initialize(anOwner);
    }

    function _initialize(address anOwner) internal virtual {
        owner = anOwner;
        emit SimpleAccountInitialized(_entryPoint, owner);
    }

    // Require the function call went through EntryPoint or owner
    function _requireFromEntryPointOrOwner() internal view {
        require(msg.sender == address(entryPoint()) || msg.sender == owner, "account: not Owner or EntryPoint");
    }

    /// @notice Grant a session key scoped authority to call specific selectors
    ///         on specific targets, expiring at `validUntil`. Use a fresh key per
    ///         authorization (re-authorizing the same key does not clear old
    ///         scopes); revoke with `revokeSession`.
    function authorizeSession(
        address key,
        uint48 validUntil,
        address[] calldata targets,
        bytes4[] calldata selectors
    ) external onlyOwner {
        require(validUntil != 0, "account: validUntil required");
        require(targets.length == selectors.length && targets.length > 0, "account: empty scope");
        sessionValidUntil[key] = validUntil;
        for (uint256 i = 0; i < targets.length; i++) {
            allowedSessionCalls[key][targets[i]][selectors[i]] = true;
        }
        emit SessionAuthorized(key, validUntil, targets, selectors);
    }

    /// @notice Revoke a session key immediately (validUntil -> 0).
    function revokeSession(address key) external onlyOwner {
        sessionValidUntil[key] = 0;
        emit SessionRevoked(key);
    }

    /// implement template method of BaseAccount
    function _validateSignature(PackedUserOperation calldata userOp, bytes32 userOpHash)
    internal override virtual returns (uint256 validationData) {
        bytes32 hash = MessageHashUtils.toEthSignedMessageHash(userOpHash);
        address signer = ECDSA.recover(hash, userOp.signature);

        // Owner: full authority.
        if (signer == owner) return SIG_VALIDATION_SUCCESS;

        // Session key: scoped, value-free, expiring authority.
        uint48 validUntil = sessionValidUntil[signer];
        if (validUntil == 0) return SIG_VALIDATION_FAILED;
        (address target, uint256 value, bytes4 selector, bool ok) = _decodeExecuteCall(userOp.callData);
        if (!ok || value != 0 || !allowedSessionCalls[signer][target][selector]) {
            return SIG_VALIDATION_FAILED;
        }
        // Expiry is enforced by the EntryPoint from the returned time-range
        // (block.timestamp is not usable during validation).
        return _packValidationData(false, validUntil, 0);
    }

    /// @dev Decode a single execute(address,uint256,bytes) call. Returns
    ///      ok == false for executeBatch or any non-execute calldata, so only
    ///      the plain single-call path can be authorized for a session key.
    function _decodeExecuteCall(bytes calldata callData)
        internal pure returns (address target, uint256 value, bytes4 selector, bool ok)
    {
        if (bytes4(callData[:4]) != this.execute.selector) return (address(0), 0, bytes4(0), false);
        if (callData.length < 136) return (address(0), 0, bytes4(0), false);
        target = address(bytes20(callData[16:36]));
        value = uint256(bytes32(callData[36:68]));
        uint256 funcLen = uint256(bytes32(callData[100:132]));
        if (funcLen < 4) return (address(0), 0, bytes4(0), false);
        selector = bytes4(callData[132:136]);
        ok = true;
    }

    function _call(address target, uint256 value, bytes memory data) internal {
        (bool success, bytes memory result) = target.call{value: value}(data);
        if (!success) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
    }

    /**
     * check current account deposit in the entryPoint
     */
    function getDeposit() public view returns (uint256) {
        return entryPoint().balanceOf(address(this));
    }

    /**
     * deposit more funds for this account in the entryPoint
     */
    function addDeposit() public payable {
        entryPoint().depositTo{value: msg.value}(address(this));
    }

    /**
     * withdraw value from the account's deposit
     * @param withdrawAddress target to send to
     * @param amount to withdraw
     */
    function withdrawDepositTo(address payable withdrawAddress, uint256 amount) public onlyOwner {
        entryPoint().withdrawTo(withdrawAddress, amount);
    }

    function _authorizeUpgrade(address newImplementation) internal view override {
        (newImplementation);
        _onlyOwner();
    }
}

