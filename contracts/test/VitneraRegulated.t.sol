// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { VitneraRWA } from "../src/VitneraRWA.sol";

contract MockIdentityRegistry {
    mapping(address => bool) public verified;

    function setVerified(address investor, bool status) external {
        verified[investor] = status;
    }

    function isVerified(address investor) external view returns (bool) {
        return verified[investor];
    }
}

contract MockErc3643Token {
    address public identityRegistry;

    constructor(address registry) {
        identityRegistry = registry;
    }

    function setIdentityRegistry(address registry) external {
        identityRegistry = registry;
    }
}

contract RevertingToken {
    function identityRegistry() external pure returns (address) {
        revert("unsupported");
    }
}

contract ZeroRegistryToken {
    function identityRegistry() external pure returns (address) {
        return address(0);
    }
}

contract VitneraRegulatedRoomTest is Test {
    VitneraRWA internal rwa;
    MockIdentityRegistry internal registryA;
    MockIdentityRegistry internal registryB;
    MockErc3643Token internal token;

    uint256 internal reviewerKey = 0xA11CE;
    address internal reviewer;
    address internal issuer = makeAddr("issuer");
    address internal investor = makeAddr("investor");
    address internal otherInvestor = makeAddr("other-investor");

    bytes32 internal constant RWA_BASIC_TEMPLATE = keccak256("rwa-basic-v1");
    bytes32 internal constant ROOT_V1 = keccak256("documents-v1");
    bytes32 internal constant KEY_V1 = keccak256("room-key-v1");
    uint256 internal constant PRICE = 0.05 ether;
    bytes32 internal constant ENCRYPTION_KEY = keccak256("investor-public-key");

    function setUp() public {
        reviewer = vm.addr(reviewerKey);
        rwa = new VitneraRWA(address(this));
        rwa.setAuthorizedReviewer(reviewer, true);
        rwa.setSupportedTemplate(RWA_BASIC_TEMPLATE, true);
        rwa.setSupportedPolicyVersion(1, true);
        vm.deal(issuer, 1 ether);
        vm.deal(investor, 10 ether);
        vm.deal(otherInvestor, 10 ether);

        registryA = new MockIdentityRegistry();
        registryB = new MockIdentityRegistry();
        token = new MockErc3643Token(address(registryA));
    }

    function _createRegulatedRoom() internal returns (uint256) {
        return _createRoom(address(token));
    }

    function _createRoom(address regulatedToken) internal returns (uint256) {
        vm.prank(issuer);
        return rwa.createDataRoom(
            keccak256("metadata-v1"),
            "ipfs://metadata-v1",
            ROOT_V1,
            KEY_V1,
            keccak256("terms-v1"),
            RWA_BASIC_TEMPLATE,
            PRICE,
            2 days,
            regulatedToken
        );
    }

    function _activate(uint256 roomId) internal {
        uint256 nonce = rwa.reviewerNonces(reviewer);
        VitneraRWA.AIReviewAttestation memory attestation = VitneraRWA.AIReviewAttestation({
            roomId: roomId,
            roomVersion: 1,
            documentRoot: ROOT_V1,
            templateId: RWA_BASIC_TEMPLATE,
            reviewStatus: VitneraRWA.ReviewStatus.ReviewReady,
            riskFlagsHash: keccak256("risk-flags"),
            reportHash: keccak256("report"),
            policyVersion: 1,
            nonce: nonce,
            expiry: uint64(block.timestamp + 7 days)
        });
        bytes32 digest = rwa.hashReviewAttestation(attestation);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(reviewerKey, digest);
        rwa.recordAIReview(attestation, abi.encodePacked(r, s, v));
        vm.prank(issuer);
        rwa.activateDataRoom(roomId);
    }

    function testGeneralRoomsRemainOpenToAnyone() public {
        uint256 roomId = _createRoom(address(0));
        _activate(roomId);

        assertEq(rwa.getRoom(roomId).regulatedToken, address(0));
        vm.prank(investor);
        rwa.requestAccess{ value: PRICE }(roomId, ENCRYPTION_KEY);
    }

    function testValidTokenLinksAndEmitsSnapshot() public {
        uint256 roomId = _createRegulatedRoom();
        _activate(roomId);

        VitneraRWA.DataRoom memory room = rwa.getRoom(roomId);
        assertEq(room.regulatedToken, address(token));

        uint256 linkedRoom;
        vm.expectEmit(true, true, false, true, address(rwa));
        emit VitneraRWA.RegulatedAssetLinked(2, address(token), address(registryA));
        linkedRoom = _createRoom(address(token));
        assertEq(linkedRoom, 2);
        assertEq(rwa.getRoom(linkedRoom).regulatedToken, address(token));
    }

    function testInvalidTokenAddressesRejectedAtCreation() public {
        RevertingToken reverting = new RevertingToken();
        ZeroRegistryToken zeroRegistry = new ZeroRegistryToken();
        address eoa = makeAddr("not-a-token");

        vm.prank(issuer);
        vm.expectRevert(VitneraRWA.InvalidRegulatedToken.selector);
        rwa.createDataRoom(
            keccak256("m"), "ipfs://m", ROOT_V1, KEY_V1, keccak256("t"), RWA_BASIC_TEMPLATE, PRICE, 2 days, eoa
        );

        vm.prank(issuer);
        vm.expectRevert(VitneraRWA.InvalidRegulatedToken.selector);
        rwa.createDataRoom(
            keccak256("m"),
            "ipfs://m",
            ROOT_V1,
            KEY_V1,
            keccak256("t"),
            RWA_BASIC_TEMPLATE,
            PRICE,
            2 days,
            address(reverting)
        );

        vm.prank(issuer);
        vm.expectRevert(VitneraRWA.InvalidRegulatedToken.selector);
        rwa.createDataRoom(
            keccak256("m"),
            "ipfs://m",
            ROOT_V1,
            KEY_V1,
            keccak256("t"),
            RWA_BASIC_TEMPLATE,
            PRICE,
            2 days,
            address(zeroRegistry)
        );
    }

    function testUnverifiedInvestorCannotDeposit() public {
        uint256 roomId = _createRegulatedRoom();
        _activate(roomId);

        vm.prank(investor);
        vm.expectRevert(VitneraRWA.InvestorNotVerified.selector);
        rwa.requestAccess{ value: PRICE }(roomId, ENCRYPTION_KEY);
        assertEq(investor.balance, 10 ether);
    }

    function testVerifiedInvestorCanRequestAccess() public {
        registryA.setVerified(investor, true);
        uint256 roomId = _createRegulatedRoom();
        _activate(roomId);

        vm.prank(investor);
        rwa.requestAccess{ value: PRICE }(roomId, ENCRYPTION_KEY);
        assertEq(investor.balance, 10 ether - PRICE);
    }

    function testLiveRegistryResolutionHonorsOwnerUpdate() public {
        registryA.setVerified(investor, false);
        registryB.setVerified(investor, true);
        uint256 roomId = _createRegulatedRoom();
        _activate(roomId);

        vm.prank(investor);
        vm.expectRevert(VitneraRWA.InvestorNotVerified.selector);
        rwa.requestAccess{ value: PRICE }(roomId, ENCRYPTION_KEY);

        token.setIdentityRegistry(address(registryB));
        vm.prank(investor);
        rwa.requestAccess{ value: PRICE }(roomId, ENCRYPTION_KEY);
    }

    function testLinkedTokenIsImmutable() public {
        uint256 roomId = _createRegulatedRoom();
        _activate(roomId);

        token.setIdentityRegistry(address(registryB));
        assertEq(rwa.getRoom(roomId).regulatedToken, address(token));
    }

    function testApprovalFailsWhenVerificationLapsedAfterDeposit() public {
        registryA.setVerified(investor, true);
        uint256 roomId = _createRegulatedRoom();
        _activate(roomId);

        vm.startPrank(investor);
        uint256 requestId = rwa.requestAccess{ value: PRICE }(roomId, ENCRYPTION_KEY);
        vm.stopPrank();

        registryA.setVerified(investor, false);

        vm.prank(issuer);
        vm.expectRevert(VitneraRWA.InvestorNotVerified.selector);
        rwa.approveAccess(requestId, keccak256("envelope"), "ipfs://envelope");

        // The deposit stays recoverable through the issuer reject path.
        assertEq(rwa.accountedBalance(), PRICE);
        vm.prank(issuer);
        rwa.rejectAccess(requestId);
        assertEq(rwa.claimableRefunds(investor), PRICE);
        assertEq(rwa.accountedBalance(), PRICE);
    }

    function testUnverifiedPendingRequestCanBeRejectedAndRefunded() public {
        uint256 roomId = _createRegulatedRoom();
        _activate(roomId);

        vm.prank(investor);
        vm.expectRevert(VitneraRWA.InvestorNotVerified.selector);
        rwa.requestAccess{ value: PRICE }(roomId, ENCRYPTION_KEY);

        // A request deposited while verified, then de-verified, is still
        // refundable without any verification check on the reject path.
        registryB.setVerified(otherInvestor, true);
        token.setIdentityRegistry(address(registryB));
        registryB.setVerified(otherInvestor, false);
        registryB.setVerified(otherInvestor, true);
        uint256 requestId;
        {
            vm.startPrank(otherInvestor);
            requestId = rwa.requestAccess{ value: PRICE }(roomId, ENCRYPTION_KEY);
            registryB.setVerified(otherInvestor, false);
            vm.stopPrank();
        }

        vm.prank(issuer);
        rwa.rejectAccess(requestId);
        assertEq(rwa.claimableRefunds(otherInvestor), PRICE);
        assertEq(rwa.totalPendingEscrow(), 0);

        vm.prank(otherInvestor);
        rwa.withdrawRefund();
        assertEq(otherInvestor.balance, 10 ether);
    }

    function testPaymentAccountingUnchangedAcrossFlows() public {
        registryA.setVerified(investor, true);
        uint256 generalRoom = _createRoom(address(0));
        _activate(generalRoom);
        uint256 regulatedRoom = _createRegulatedRoom();
        _activate(regulatedRoom);

        vm.prank(investor);
        uint256 generalRequestId = rwa.requestAccess{ value: PRICE }(generalRoom, ENCRYPTION_KEY);
        vm.prank(investor);
        uint256 regulatedRequestId = rwa.requestAccess{ value: PRICE }(regulatedRoom, ENCRYPTION_KEY);

        assertEq(rwa.accountedBalance(), 2 * PRICE);
        assertEq(address(rwa).balance, 2 * PRICE);

        vm.startPrank(issuer);
        rwa.approveAccess(generalRequestId, keccak256("e1"), "ipfs://e1");
        rwa.approveAccess(regulatedRequestId, keccak256("e2"), "ipfs://e2");
        vm.stopPrank();

        assertEq(rwa.claimableEarnings(issuer), 2 * PRICE);
        assertEq(rwa.totalPendingEscrow(), 0);
        assertEq(rwa.accountedBalance(), 2 * PRICE);
    }
}
