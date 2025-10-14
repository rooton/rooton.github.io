class WHIPClient {
  constructor(whipUrl) {
    this.whipUrl = whipUrl;
    this.resourceUrl = null;
    this.peerConnection = null;
    this.stream = null;
  }

  async startStreaming(stream) {
    this.stream = stream;

    try {
      // Create peer connection
      this.peerConnection = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' }
          // Add TURN servers if needed for NAT traversal
        ]
      });

      // Add tracks
      stream.getTracks().forEach(track => {
        this.peerConnection.addTrack(track, stream);
      });

      // Create offer
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);

      // Send to WHIP endpoint
      const response = await this.sendWHIPRequest(offer.sdp);

      if (response.status === 201) {
        this.resourceUrl = response.headers.get('Location');
        const answerSdp = await response.text();

        await this.peerConnection.setRemoteDescription({
          type: 'answer',
          sdp: answerSdp
        });

        // Set up ICE candidate handling
        this.setupIceCandidateHandling();

        return this.resourceUrl;
      } else {
        throw new Error(`WHIP server error: ${response.status}`);
      }

    } catch (error) {
      console.error('WHIP streaming failed:', error);
      this.cleanup();
      throw error;
    }
  }

  async sendWHIPRequest(sdp) {
    return fetch(this.whipUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sdp'
      },
      body: sdp
    });
  }

  setupIceCandidateHandling() {
    this.peerConnection.onicecandidate = async (event) => {
      if (event.candidate && this.resourceUrl) {
        try {
          await this.sendIceCandidate(event.candidate);
        } catch (error) {
          console.warn('Failed to send ICE candidate:', error);
        }
      }
    };
  }

  async sendIceCandidate(candidate) {
    return fetch(this.resourceUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/trickle-ice-sdpfrag'
      },
      body: JSON.stringify({
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex
      })
    });
  }

  async stopStreaming() {
    if (this.resourceUrl) {
      try {
        await fetch(this.resourceUrl, {
          method: 'DELETE'
        });
      } catch (error) {
        console.warn('Error stopping WHIP stream:', error);
      }
    }
    this.cleanup();
  }

  cleanup() {
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    this.resourceUrl = null;
  }

  // Optional: Add reconnection logic
  async reconnect() {
    if (this.stream && this.whipUrl) {
      await this.stopStreaming();
      await this.startStreaming(this.stream);
    }
  }
}