// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { VitneraRWA } from "../src/VitneraRWA.sol";

contract VitneraRWATest is Test {
    VitneraRWA internal rwa;

    uint256 internal reviewerKey = 0xA11CE;
    address internal reviewer;
    uint256 internal verifierKey = 0xB0B;
    address internal verifier;
    address internal issuer = makeAddr("issuer");
    address internal investor = makeAddr("investor");

    bytes32 internal constant RWA_BASIC_TEMPLATE = keccak256("rwa-basic-v1");
    bytes32 internal constant ROOT_V1 = keccak256("documents-v1");
    bytes32 internal constant ROOT_V2 = keccak256("documents-v2");
    bytes32 internal constant KEY_V1 = keccak256("room-key-v1");
    bytes32 internal constant KEY_V2 = keccak256("room-key-v2");
    uint256 internal constant PRICE = 0.05 ether;

    function setUp() public {
        reviewer = vm.addr(reviewerKey);
        verifier = vm.addr(verifierKey);
        rwa = new VitneraRWA(address(this));
        rwa.setAuthorizedReviewer(reviewer, true);
        rwa.setAuthorizedVerifier(verifier, true);
        rwa.setSupportedTemplate(RWA_BASIC_TEMPLATE, true);
        rwa.setSupportedPolicyVersion(1, true);
        vm.deal(investor, 10 ether);
        vm.deal(issuer, 1 ether);
    }

    function testCreateStartsReviewRequiredAndCannotActivate() public {
        uint256 roomId = _createRoom();
        VitneraRWA.DataRoom memory room = rwa.getRoom(roomId);
        assertEq(uint8(room.status), uint8(VitneraRWA.RoomStatus.ReviewRequired));
        assertEq(room.version, 1);

        vm.prank(issuer);
        vm.expectRevert(VitneraRWA.InvalidReview.selector);
        rwa.activateDataRoom(roomId);
    }

    function testAIReviewGatesActivation() public {
        uint256 roomId = _createRoom();
        uint256 reviewId = _recordReview(roomId, ROOT_V1, 1, VitneraRWA.ReviewStatus.ReviewReady);

        vm.prank(issuer);
        rwa.activateDataRoom(roomId);

        VitneraRWA.DataRoom memory room = rwa.getRoom(roomId);
        assertEq(room.currentReviewId, reviewId);
        assertEq(uint8(room.status), uint8(VitneraRWA.RoomStatus.Active));
        assertTrue(rwa.isRoomReviewReady(roomId));
    }

    function testNeedsReviewCannotActivate() public {
        uint256 roomId = _createRoom();
        _recordReview(roomId, ROOT_V1, 1, VitneraRWA.ReviewStatus.NeedsReview);

        vm.prank(issuer);
        vm.expectRevert(VitneraRWA.InvalidReview.selector);
        rwa.activateDataRoom(roomId);
    }

    function testIssuerCanAcknowledgeFindingsAndActivate() public {
        uint256 roomId = _createRoom();
        uint256 reviewId = _recordReview(roomId, ROOT_V1, 1, VitneraRWA.ReviewStatus.NeedsReview);
        bytes32 acknowledgement = keccak256("issuer-accepts-review-findings");

        vm.prank(issuer);
        rwa.activateDataRoomWithAcknowledgement(roomId, acknowledgement);

        assertEq(uint8(rwa.getRoom(roomId).status), uint8(VitneraRWA.RoomStatus.Active));
        assertEq(rwa.acknowledgedReviewId(roomId), reviewId);
        assertEq(rwa.reviewAcknowledgementHash(roomId), acknowledgement);
        assertTrue(rwa.isRoomReviewAccepted(roomId));
        assertFalse(rwa.isRoomReviewReady(roomId));

        _requestAccess(roomId);
    }

    function testCannotAcknowledgeWithoutCurrentSignedReview() public {
        uint256 roomId = _createRoom();
        vm.prank(issuer);
        vm.expectRevert(VitneraRWA.InvalidReview.selector);
        rwa.activateDataRoomWithAcknowledgement(roomId, keccak256("acknowledgement"));
    }

    function testReadyReviewCanRecordAndActivateAtomically() public {
        uint256 roomId = _createRoom();
        VitneraRWA.AIReviewAttestation memory attestation =
            _attestation(roomId, ROOT_V1, 1, VitneraRWA.ReviewStatus.ReviewReady, 0);
        bytes memory signature = _sign(attestation);

        vm.prank(issuer);
        uint256 reviewId = rwa.recordReviewAndActivate(attestation, signature);

        VitneraRWA.DataRoom memory room = rwa.getRoom(roomId);
        assertEq(room.currentReviewId, reviewId);
        assertEq(uint8(room.status), uint8(VitneraRWA.RoomStatus.Active));
        assertEq(rwa.reviewerNonces(reviewer), 1);
    }

    function testNonReadyAtomicReviewRevertsWithoutConsumingNonce() public {
        uint256 roomId = _createRoom();
        VitneraRWA.AIReviewAttestation memory attestation =
            _attestation(roomId, ROOT_V1, 1, VitneraRWA.ReviewStatus.NeedsReview, 0);
        bytes memory signature = _sign(attestation);

        vm.prank(issuer);
        vm.expectRevert(VitneraRWA.InvalidReview.selector);
        rwa.recordReviewAndActivate(attestation, signature);

        assertEq(rwa.reviewCount(), 0);
        assertEq(rwa.reviewerNonces(reviewer), 0);
    }

    function testVerifierAttestationIsRootBoundAndReplayProtected() public {
        uint256 roomId = _createRoom();
        VitneraRWA.VerifierAttestation memory attestation = VitneraRWA.VerifierAttestation({
            roomId: roomId,
            roomVersion: 1,
            documentRoot: ROOT_V1,
            findingsHash: keccak256("independent-findings"),
            nonce: 0,
            expiry: uint64(block.timestamp + 7 days)
        });
        bytes32 digest = rwa.hashVerifierAttestation(attestation);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(verifierKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);
        uint256 attestationId = rwa.recordVerifierAttestation(attestation, signature);
        assertEq(rwa.getVerifierAttestation(attestationId).verifier, verifier);

        vm.expectRevert(VitneraRWA.InvalidAttestation.selector);
        rwa.recordVerifierAttestation(attestation, signature);
    }

    function testRejectsWrongRootAndReplayNonce() public {
        uint256 roomId = _createRoom();
        VitneraRWA.AIReviewAttestation memory wrong =
            _attestation(roomId, ROOT_V2, 1, VitneraRWA.ReviewStatus.ReviewReady, 0);
        bytes memory wrongSignature = _sign(wrong);
        vm.expectRevert(VitneraRWA.InvalidAttestation.selector);
        rwa.recordAIReview(wrong, wrongSignature);

        VitneraRWA.AIReviewAttestation memory valid =
            _attestation(roomId, ROOT_V1, 1, VitneraRWA.ReviewStatus.ReviewReady, 0);
        bytes memory signature = _sign(valid);
        rwa.recordAIReview(valid, signature);

        vm.expectRevert(VitneraRWA.InvalidAttestation.selector);
        rwa.recordAIReview(valid, signature);
    }

    function testExactPaymentAndApprovalCreditsIssuer() public {
        uint256 roomId = _createActiveRoom();

        vm.prank(investor);
        vm.expectRevert(VitneraRWA.InvalidPayment.selector);
        rwa.requestAccess{ value: 1 wei }(roomId, keccak256("investor-public-key"));

        uint256 requestId = _requestAccess(roomId);
        assertEq(address(rwa).balance, PRICE);
        assertEq(rwa.totalPendingEscrow(), PRICE);

        vm.prank(issuer);
        rwa.approveAccess(requestId, keccak256("envelope"), "ipfs://envelope-cid");

        assertEq(rwa.totalPendingEscrow(), 0);
        assertEq(rwa.claimableEarnings(issuer), PRICE);
        assertEq(rwa.accountedBalance(), address(rwa).balance);

        uint256 before = issuer.balance;
        vm.prank(issuer);
        rwa.withdrawEarnings();
        assertEq(issuer.balance, before + PRICE);
        assertEq(address(rwa).balance, 0);
    }

    function testCompleteIssuerToInvestorLifecycle() public {
        uint256 roomId = _createRoom();
        VitneraRWA.AIReviewAttestation memory attestation =
            _attestation(roomId, ROOT_V1, 1, VitneraRWA.ReviewStatus.ReviewReady, 0);
        bytes memory signature = _sign(attestation);

        vm.prank(issuer);
        rwa.recordReviewAndActivate(attestation, signature);

        uint256 requestId = _requestAccess(roomId);
        vm.prank(issuer);
        rwa.approveAccess(requestId, keccak256("investor-envelope"), "ipfs://investor-envelope");

        assertEq(uint8(rwa.getRoom(roomId).status), uint8(VitneraRWA.RoomStatus.Active));
        assertEq(uint8(rwa.getAccessRequest(requestId).status), uint8(VitneraRWA.RequestStatus.Approved));
        assertEq(rwa.claimableEarnings(issuer), PRICE);

        uint256 issuerBalance = issuer.balance;
        vm.prank(issuer);
        rwa.withdrawEarnings();
        assertEq(issuer.balance, issuerBalance + PRICE);
    }

    function testRejectCreditsPullRefund() public {
        uint256 roomId = _createActiveRoom();
        uint256 requestId = _requestAccess(roomId);

        vm.prank(issuer);
        rwa.rejectAccess(requestId);
        assertEq(rwa.claimableRefunds(investor), PRICE);
        assertEq(rwa.totalPendingEscrow(), 0);

        uint256 before = investor.balance;
        vm.prank(investor);
        rwa.withdrawRefund();
        assertEq(investor.balance, before + PRICE);
    }

    function testExpiredRequestCanBeRefunded() public {
        uint256 roomId = _createActiveRoom();
        uint256 requestId = _requestAccess(roomId);
        VitneraRWA.AccessRequest memory request = rwa.getAccessRequest(requestId);

        vm.warp(request.expiresAt);
        vm.prank(investor);
        rwa.refundExpiredRequest(requestId);
        assertEq(rwa.claimableRefunds(investor), PRICE);
    }

    function testDocumentUpdateRotatesKeyAndInvalidatesReview() public {
        uint256 roomId = _createActiveRoom();
        uint256 requestId = _requestAccess(roomId);

        vm.prank(issuer);
        vm.expectRevert(VitneraRWA.InvalidConfiguration.selector);
        rwa.updateDocumentRoot(roomId, ROOT_V2, keccak256("metadata-v2"), "ipfs://metadata-v2", KEY_V1);

        vm.prank(issuer);
        rwa.updateDocumentRoot(roomId, ROOT_V2, keccak256("metadata-v2"), "ipfs://metadata-v2", KEY_V2);

        VitneraRWA.DataRoom memory room = rwa.getRoom(roomId);
        assertEq(room.version, 2);
        assertEq(room.currentReviewId, 0);
        assertEq(uint8(room.status), uint8(VitneraRWA.RoomStatus.ReviewRequired));
        assertFalse(rwa.isRoomReviewReady(roomId));

        vm.prank(issuer);
        vm.expectRevert(VitneraRWA.InvalidStatus.selector);
        rwa.approveAccess(requestId, keccak256("envelope"), "ipfs://stale-envelope");

        vm.prank(investor);
        rwa.refundExpiredRequest(requestId);
        assertEq(rwa.claimableRefunds(investor), PRICE);
    }

    function testApprovedAccessCanBeMarkedRevoked() public {
        uint256 roomId = _createActiveRoom();
        uint256 requestId = _requestAccess(roomId);
        vm.prank(issuer);
        rwa.approveAccess(requestId, keccak256("envelope"), "ipfs://envelope-cid");

        vm.prank(issuer);
        rwa.revokeAccess(requestId);
        assertEq(uint8(rwa.getAccessRequest(requestId).status), uint8(VitneraRWA.RequestStatus.Revoked));
    }

    function testCannotOpenDuplicatePendingOrApprovedRequest() public {
        uint256 roomId = _createActiveRoom();
        _requestAccess(roomId);

        vm.prank(investor);
        vm.expectRevert(VitneraRWA.ExistingRequest.selector);
        rwa.requestAccess{ value: PRICE }(roomId, keccak256("second-public-key"));
    }

    function testFuzzExactPaymentIsEnforced(uint96 wrongAmount) public {
        uint256 roomId = _createActiveRoom();
        vm.assume(wrongAmount != PRICE);
        vm.deal(investor, uint256(wrongAmount) + 1 ether);
        vm.prank(investor);
        vm.expectRevert(VitneraRWA.InvalidPayment.selector);
        rwa.requestAccess{ value: wrongAmount }(roomId, keccak256("investor-public-key"));
    }

    function _createRoom() internal returns (uint256) {
        return _createRoom(address(0));
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

    function _createActiveRoom() internal returns (uint256 roomId) {
        roomId = _createRoom();
        _recordReview(roomId, ROOT_V1, 1, VitneraRWA.ReviewStatus.ReviewReady);
        vm.prank(issuer);
        rwa.activateDataRoom(roomId);
    }

    function _requestAccess(uint256 roomId) internal returns (uint256) {
        vm.prank(investor);
        return rwa.requestAccess{ value: PRICE }(roomId, keccak256("investor-public-key"));
    }

    function _recordReview(uint256 roomId, bytes32 root, uint64 version, VitneraRWA.ReviewStatus status)
        internal
        returns (uint256)
    {
        uint256 nonce = rwa.reviewerNonces(reviewer);
        VitneraRWA.AIReviewAttestation memory attestation = _attestation(roomId, root, version, status, nonce);
        return rwa.recordAIReview(attestation, _sign(attestation));
    }

    function _attestation(
        uint256 roomId,
        bytes32 root,
        uint64 version,
        VitneraRWA.ReviewStatus status,
        uint256 nonce
    ) internal view returns (VitneraRWA.AIReviewAttestation memory) {
        return VitneraRWA.AIReviewAttestation({
            roomId: roomId,
            roomVersion: version,
            documentRoot: root,
            templateId: RWA_BASIC_TEMPLATE,
            reviewStatus: status,
            riskFlagsHash: keccak256("risk-flags"),
            reportHash: keccak256("report"),
            policyVersion: 1,
            nonce: nonce,
            expiry: uint64(block.timestamp + 7 days)
        });
    }

    function _sign(VitneraRWA.AIReviewAttestation memory attestation) internal view returns (bytes memory) {
        bytes32 digest = rwa.hashReviewAttestation(attestation);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(reviewerKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
